"""
Ticker details — everything the per-ticker details panel shows, in one call.

Assembled on demand from data the app already caches; nothing here is stored.
Candlestick history is computed from the cached bars at request time (TA-Lib is
microseconds), so the panel can show *which day* each pattern formed without
persisting per-day pattern history.

Public API:
    get_ticker_details(symbol, days) -> dict | None
"""

import logging
from concurrent.futures import ThreadPoolExecutor

from app.database import get_client
from app.services import signal_rules as sr
from app.services.candlesticks import recent_patterns
from app.services.feature_context import VARIABLE_LABELS, features_from, snapshot_present
from app.services.indicator_cache import get_latest_snapshots
from app.services.indicators import bars_to_dataframe
from app.services.ohlcv_cache import get_cached_bars
from app.services.rule_engine import format_human

logger = logging.getLogger(__name__)

# Bars returned for the panel's mini chart (~3 months); also plenty of history
# for TA-Lib's candle-size averages.
DETAIL_BARS = 60

_TICKER_FIELDS = "symbol,name,sector,industry"
_POSITION_FIELDS = (
    "id,direction,is_simulated,entry_date,entry_price,shares,initial_stop_price,"
    "stop_price,target_price,time_stop_date,risk_per_share,risk_amount"
)


def _one(table: str, fields: str, symbol: str, **eq) -> dict | None:
    q = get_client().table(table).select(fields).eq("symbol", symbol)
    for col, val in eq.items():
        q = q.eq(col, val)
    rows = q.limit(1).execute().data
    return rows[0] if rows else None


def _last(bars: list[dict]) -> dict | None:
    if not bars:
        return None
    close = float(bars[-1]["close"])
    prev = float(bars[-2]["close"]) if len(bars) > 1 else None
    change = close - prev if prev else None
    return {
        "date": bars[-1]["date"],
        "close": close,
        "change": round(change, 4) if change is not None else None,
        "change_pct": round(change / prev * 100, 2) if change is not None else None,
    }


def _signals(snapshot: dict | None, bars: list[dict], rules: list[dict]) -> dict | None:
    features = features_from(snapshot, bars)
    if not snapshot_present(features):
        return None
    res = sr.evaluate_signals(features, rules)
    return {
        "score": res["signal_score"],
        "max": res["max_signal_score"],
        "normalized": res["signal_score_normalized"],
        "rules": [
            {
                "slug": r["slug"],
                "name": r["name"],
                "weight": r.get("weight") or 1,
                "fired": bool(res["signals"].get(r["slug"])),
                "formatted": _format(r["expression"]),
            }
            for r in rules
        ],
    }


def _format(expression) -> str | None:
    try:
        return format_human(expression, VARIABLE_LABELS)
    except Exception:  # display only — never fail the panel over formatting
        return None


def _position(pos: dict | None, last_close: float | None) -> dict | None:
    if not pos:
        return None
    entry = float(pos["entry_price"])
    risk = float(pos["risk_per_share"])
    sign = -1 if pos.get("direction") == "short" else 1
    pos["r_now"] = round(sign * (last_close - entry) / risk, 2) if last_close is not None and risk else None
    return pos


def get_ticker_details(symbol: str, days: int = 10) -> dict | None:
    """
    Details for one ticker, or None if the app knows nothing about it (not in
    the universe and no cached bars).
    """
    sym = symbol.upper()
    # The reads are independent: run them concurrently (one round trip of
    # latency instead of six).
    with ThreadPoolExecutor(max_workers=6) as pool:
        f_ticker = pool.submit(_one, "tickers", _TICKER_FIELDS, sym)
        f_bars = pool.submit(get_cached_bars, sym, DETAIL_BARS)
        f_snaps = pool.submit(get_latest_snapshots, [sym])
        f_rules = pool.submit(sr.get_enabled_rules)
        f_pos = pool.submit(_one, "positions", _POSITION_FIELDS, sym, status="open")
        f_wl = pool.submit(_one, "watchlist", "symbol", sym)
    ticker, bars = f_ticker.result(), f_bars.result()
    if ticker is None and not bars:
        return None

    snaps = f_snaps.result()
    snapshot = snaps[0] if snaps else None
    last = _last(bars)

    try:
        patterns = recent_patterns(bars_to_dataframe(bars), days) if bars else []
    except Exception as exc:  # a bad bar must not take down the whole panel
        logger.warning("%s: pattern history failed: %s", sym, exc)
        patterns = []

    return {
        "symbol": sym,
        "name": (ticker or {}).get("name"),
        "sector": (ticker or {}).get("sector"),
        "industry": (ticker or {}).get("industry"),
        "in_watchlist": f_wl.result() is not None,
        "last": last,
        "bars": [
            {k: (b[k] if k == "date" else float(b[k])) for k in ("date", "open", "high", "low", "close", "volume")}
            for b in bars
        ],
        "pattern_days": days,
        "patterns": patterns,
        "snapshot": snapshot,
        "signals": _signals(snapshot, bars, f_rules.result()),
        "position": _position(f_pos.result(), last["close"] if last else None),
    }
