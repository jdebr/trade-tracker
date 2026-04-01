"""
Intraday quote poller — runs Mon–Fri at 9:30, 11:00, 12:30, 14:00, 15:30 ET.

For each watchlist symbol:
  1. Fetch current price via yfinance fast_info
  2. Compare against last EOD indicator snapshot (bb_lower, bb_upper, ema_8)
  3. Fire intraday alert conditions (deduped per symbol+type per calendar day)

Alert types generated:
  price_below_lower_bb — current price < bb_lower
  price_above_upper_bb — current price > bb_upper
  price_below_ema8     — current price < ema_8
  price_above_ema8     — current price > ema_8

Public API:
  fetch_intraday_quote(symbol) -> float
  evaluate_intraday_conditions(...) -> tuple[list[dict], int]
  run_intraday_poll() -> dict
"""

import logging
from datetime import date, datetime, timezone

import yfinance as yf

from app.database import get_client
from app.services.indicator_cache import get_latest_snapshots
from app.services.scanner import _get_watchlist_symbols

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Quote fetch
# ---------------------------------------------------------------------------

def fetch_intraday_quote(symbol: str) -> float:
    """
    Return the most-recent trade price for symbol using yfinance.
    Raises ValueError if the price cannot be retrieved.
    """
    info = yf.Ticker(symbol).fast_info
    price = info.get("last_price") or info.get("lastPrice")
    if price is None or price != price:  # NaN check
        raise ValueError(f"No intraday price available for {symbol}")
    return float(price)


# ---------------------------------------------------------------------------
# Dedup helper
# ---------------------------------------------------------------------------

def _get_existing_intraday_alerts_today(
    symbols: list[str], today: date
) -> set[tuple[str, str]]:
    """
    Return (symbol, alert_type) pairs already inserted today for the given symbols.
    Reuses the same alerts table as the EOD scanner — no duplicate per calendar day.
    """
    if not symbols:
        return set()
    res = (
        get_client()
        .table("alerts")
        .select("symbol,alert_type")
        .in_("symbol", symbols)
        .eq("date", today.isoformat())
        .execute()
    )
    return {(row["symbol"], row["alert_type"]) for row in res.data}


# ---------------------------------------------------------------------------
# Condition evaluation (exported for unit tests)
# ---------------------------------------------------------------------------

def evaluate_intraday_conditions(
    symbol:        str,
    current_price: float,
    snapshot:      dict,
    existing:      set[tuple[str, str]],
    today:         date,
) -> tuple[list[dict], int]:
    """
    Evaluate the four intraday price-vs-snapshot conditions for one symbol.

    Returns:
        (new_alerts, skipped_count)
        new_alerts    — alert dicts ready to insert (deduped against existing)
        skipped_count — conditions that fired but were already in existing
    """
    alerts:  list[dict] = []
    skipped: int        = 0

    bb_upper = snapshot.get("bb_upper")
    bb_lower = snapshot.get("bb_lower")
    ema_8    = snapshot.get("ema_8")

    def _add(alert_type: str, details: dict) -> None:
        nonlocal skipped
        if (symbol, alert_type) in existing:
            skipped += 1
            return
        alerts.append({
            "symbol":           symbol,
            "date":             today.isoformat(),
            "alert_type":       alert_type,
            "price_at_trigger": current_price,
            "details":          details,
            "acknowledged":     False,
        })

    if bb_lower is not None and current_price < float(bb_lower):
        _add("price_below_lower_bb", {"bb_lower": round(float(bb_lower), 4)})

    if bb_upper is not None and current_price > float(bb_upper):
        _add("price_above_upper_bb", {"bb_upper": round(float(bb_upper), 4)})

    if ema_8 is not None and current_price < float(ema_8):
        _add("price_below_ema8", {"ema_8": round(float(ema_8), 4)})

    if ema_8 is not None and current_price > float(ema_8):
        _add("price_above_ema8", {"ema_8": round(float(ema_8), 4)})

    return alerts, skipped


# ---------------------------------------------------------------------------
# Poll orchestrator
# ---------------------------------------------------------------------------

def run_intraday_poll() -> dict:
    """
    Intraday poll pipeline:
      1. Load watchlist symbols
      2. Fetch current price for each (yfinance fast_info)
      3. Load latest EOD indicator snapshots
      4. Evaluate price-vs-snapshot conditions (deduped)
      5. Insert new alerts

    Returns a summary dict.
    """
    started_at = datetime.now(timezone.utc)
    logger.info("Intraday poll starting")

    symbols = _get_watchlist_symbols()
    if not symbols:
        logger.info("Intraday poll: watchlist is empty — skipping")
        return {
            "symbols_polled": 0,
            "alerts_created": 0,
            "alerts_skipped": 0,
            "failed": 0,
            "started_at": started_at.isoformat(),
        }

    today = date.today()

    # Fetch current prices — collect failures, don't abort
    prices: dict[str, float] = {}
    failed = 0
    for symbol in symbols:
        try:
            prices[symbol] = fetch_intraday_quote(symbol)
        except Exception as exc:
            logger.warning("Intraday quote fetch failed for %s: %s", symbol, exc)
            failed += 1

    if not prices:
        logger.warning("Intraday poll: all quote fetches failed")
        return {
            "symbols_polled": len(symbols),
            "alerts_created": 0,
            "alerts_skipped": 0,
            "failed": failed,
            "started_at": started_at.isoformat(),
        }

    # Load latest snapshots for symbols that succeeded
    fetched_symbols = list(prices.keys())
    snapshots = get_latest_snapshots(fetched_symbols)
    snap_by_sym = {s["symbol"]: s for s in snapshots}

    existing = _get_existing_intraday_alerts_today(fetched_symbols, today)

    # Evaluate conditions
    new_alerts: list[dict] = []
    total_skipped = 0
    for symbol, price in prices.items():
        snap = snap_by_sym.get(symbol)
        if snap is None:
            logger.debug("No snapshot for %s — skipping intraday evaluation", symbol)
            continue
        fired, skipped = evaluate_intraday_conditions(
            symbol=symbol,
            current_price=price,
            snapshot=snap,
            existing=existing,
            today=today,
        )
        new_alerts.extend(fired)
        total_skipped += skipped

    if new_alerts:
        get_client().table("alerts").insert(new_alerts).execute()

    logger.info(
        "Intraday poll complete — %d polled, %d alert(s) created, "
        "%d dedup-skipped, %d failed",
        len(symbols), len(new_alerts), total_skipped, failed,
    )

    return {
        "symbols_polled": len(symbols),
        "alerts_created": len(new_alerts),
        "alerts_skipped": total_skipped,
        "failed": failed,
        "started_at": started_at.isoformat(),
    }
