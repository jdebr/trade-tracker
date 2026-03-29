"""
Watchlist scanner — the core job run by the scheduler.

Pipeline per run:
  1. Load symbols from watchlist
  2. Fetch fresh OHLCV for stale symbols (Twelve Data → yfinance fallback)
  3. Recompute indicator snapshots from fresh bars
  4. Evaluate alert conditions against the latest (and prior) snapshot
  5. Insert new alerts, skipping any (symbol, alert_type, date) already in DB today

Alert types generated:
  bb_squeeze      — bb_squeeze flag is True
  rsi_oversold    — rsi_14 < 30
  rsi_overbought  — rsi_14 > 70
  macd_crossover  — macd_hist crossed from ≤0 to >0 (bullish histogram flip)
  ema_crossover   — ema_8 crossed from below to above ema_21
  vol_expansion   — avg(last 3d volume) > avg(last 20d volume)

Public API:
    run_watchlist_scan() -> ScanResult
    _evaluate_conditions(...)  (also exported for unit testing)
"""

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from app.database import get_client
from app.services.indicator_cache import upsert_snapshots
from app.services.indicators import compute_indicators
from app.services.market_data import fetch_ohlcv
from app.services.ohlcv_cache import get_cached_bars, is_cache_fresh, upsert_bars

logger = logging.getLogger(__name__)

RSI_OVERSOLD   = 30.0
RSI_OVERBOUGHT = 70.0


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class ScanResult:
    symbols_scanned:       int       = 0
    ohlcv_fetched:         int       = 0
    ohlcv_cached:          int       = 0
    ohlcv_failed:          list[str] = field(default_factory=list)
    indicators_computed:   int       = 0
    indicators_skipped:    list[str] = field(default_factory=list)
    alerts_created:        int       = 0
    alerts_skipped_dedup:  int       = 0
    run_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict:
        return {
            "symbols_scanned":      self.symbols_scanned,
            "ohlcv_fetched":        self.ohlcv_fetched,
            "ohlcv_cached":         self.ohlcv_cached,
            "ohlcv_failed":         self.ohlcv_failed,
            "indicators_computed":  self.indicators_computed,
            "indicators_skipped":   self.indicators_skipped,
            "alerts_created":       self.alerts_created,
            "alerts_skipped_dedup": self.alerts_skipped_dedup,
            "run_at":               self.run_at.isoformat(),
        }


# ---------------------------------------------------------------------------
# Pipeline helpers
# ---------------------------------------------------------------------------

def _get_watchlist_symbols() -> list[str]:
    result = get_client().table("watchlist").select("symbol").execute()
    return [row["symbol"] for row in result.data]


def _fetch_ohlcv_for_symbols(symbols: list[str], result: ScanResult) -> None:
    """Fetch + upsert OHLCV for stale symbols. Mutates result in place."""
    all_bars: list[dict] = []
    for symbol in symbols:
        if is_cache_fresh(symbol):
            result.ohlcv_cached += 1
            continue
        try:
            bars = fetch_ohlcv(symbol)
            all_bars.extend(bars)
            result.ohlcv_fetched += 1
        except Exception as exc:
            logger.error("OHLCV fetch failed for %s: %s", symbol, exc)
            result.ohlcv_failed.append(symbol)

    if all_bars:
        upsert_bars(all_bars)


def _compute_indicators_for_symbols(
    symbols: list[str], result: ScanResult
) -> list[dict]:
    """Compute + upsert indicator snapshots. Returns list of snapshot dicts."""
    snapshots: list[dict] = []
    for symbol in symbols:
        try:
            snap = compute_indicators(symbol)
            if snap is None:
                result.indicators_skipped.append(symbol)
            else:
                snapshots.append(snap)
                result.indicators_computed += 1
        except Exception as exc:
            logger.error("Indicator compute failed for %s: %s", symbol, exc)
            result.indicators_skipped.append(symbol)

    upsert_snapshots(snapshots)
    return snapshots


def _get_prior_snapshots(symbols: list[str]) -> dict[str, dict | None]:
    """
    For each symbol, return the second-most-recent indicator snapshot.
    Used for crossover detection (need two consecutive bars).
    Returns {symbol: snapshot_dict | None}.
    """
    priors: dict[str, dict | None] = {}
    for symbol in symbols:
        res = (
            get_client()
            .table("indicator_snapshots")
            .select("date,macd_hist,ema_8,ema_21")
            .eq("symbol", symbol)
            .order("date", desc=True)
            .limit(2)
            .execute()
        )
        rows = res.data
        priors[symbol] = rows[1] if len(rows) >= 2 else None
    return priors


def _get_market_data(symbols: list[str]) -> dict[str, dict]:
    """
    Return {symbol: {vol_3d, vol_20d, last_close}} from ohlcv_cache.
    Symbols with insufficient bars are omitted.
    """
    data: dict[str, dict] = {}
    for symbol in symbols:
        bars = get_cached_bars(symbol, limit=20)  # oldest → newest
        if not bars:
            continue
        volumes   = [b["volume"] for b in bars]
        last_close = float(bars[-1]["close"])
        vol_3d    = sum(volumes[-3:]) / min(3, len(volumes))
        vol_20d   = sum(volumes)      / len(volumes)
        data[symbol] = {
            "vol_3d":     vol_3d,
            "vol_20d":    vol_20d,
            "last_close": last_close,
        }
    return data


def _get_existing_alerts_today(
    symbols: list[str], today: date
) -> set[tuple[str, str]]:
    """
    Return (symbol, alert_type) pairs already inserted for today.
    Used to prevent duplicate alerts on re-runs.
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

def _evaluate_conditions(
    snap:        dict,
    prior:       dict | None,
    market_data: dict | None,
    existing:    set[tuple[str, str]],
    today:       date,
) -> tuple[list[dict], int]:
    """
    Evaluate all 6 alert conditions for one symbol snapshot.

    Returns:
        (new_alerts, skipped_count)
        new_alerts    — alert dicts ready to insert (deduped against existing)
        skipped_count — conditions that fired but were already in existing
    """
    symbol      = snap["symbol"]
    close_price = (market_data or {}).get("last_close")
    vol_3d      = (market_data or {}).get("vol_3d")
    vol_20d     = (market_data or {}).get("vol_20d")

    alerts:  list[dict] = []
    skipped: int        = 0

    def _add(alert_type: str, details: dict) -> None:
        nonlocal skipped
        if (symbol, alert_type) in existing:
            skipped += 1
            return
        alerts.append({
            "symbol":           symbol,
            "date":             today.isoformat(),
            "alert_type":       alert_type,
            "price_at_trigger": close_price,
            "details":          details,
            "acknowledged":     False,
        })

    rsi   = snap.get("rsi_14")
    bb_sq = snap.get("bb_squeeze")
    mh    = snap.get("macd_hist")
    e8    = snap.get("ema_8")
    e21   = snap.get("ema_21")

    # bb_squeeze
    if bb_sq is True:
        _add("bb_squeeze", {"bb_width": snap.get("bb_width")})

    # rsi_oversold / overbought
    if rsi is not None:
        if float(rsi) < RSI_OVERSOLD:
            _add("rsi_oversold",  {"rsi_14": round(float(rsi), 2)})
        if float(rsi) > RSI_OVERBOUGHT:
            _add("rsi_overbought", {"rsi_14": round(float(rsi), 2)})

    # macd_crossover: macd_hist flips from ≤0 to >0
    if prior and mh is not None:
        prev_mh = prior.get("macd_hist")
        if prev_mh is not None and float(prev_mh) <= 0 and float(mh) > 0:
            _add("macd_crossover", {
                "macd_hist":      round(float(mh),      4),
                "prev_macd_hist": round(float(prev_mh), 4),
            })

    # ema_crossover: ema_8 crosses above ema_21
    if prior and e8 is not None and e21 is not None:
        prev_e8  = prior.get("ema_8")
        prev_e21 = prior.get("ema_21")
        if prev_e8 is not None and prev_e21 is not None:
            if float(prev_e8) <= float(prev_e21) and float(e8) > float(e21):
                _add("ema_crossover", {
                    "ema_8":  round(float(e8),  2),
                    "ema_21": round(float(e21), 2),
                })

    # vol_expansion: 3-day average volume exceeds 20-day average
    if vol_3d is not None and vol_20d is not None and vol_3d > vol_20d:
        _add("vol_expansion", {
            "vol_3d":  round(vol_3d),
            "vol_20d": round(vol_20d),
        })

    return alerts, skipped


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def run_watchlist_scan() -> ScanResult:
    """
    Full watchlist scan pipeline.  Synchronous — safe to call from a thread.
    Returns ScanResult with per-step counts.
    """
    result = ScanResult()
    today  = date.today()

    # 1. Load watchlist
    symbols = _get_watchlist_symbols()
    if not symbols:
        logger.info("Watchlist is empty — scan skipped")
        return result
    result.symbols_scanned = len(symbols)
    logger.info("Scan starting for %d watchlist symbol(s)", len(symbols))

    # 2. Fetch fresh OHLCV (skips symbols whose cache is already current)
    _fetch_ohlcv_for_symbols(symbols, result)

    # 3. Compute + upsert indicator snapshots
    snapshots = _compute_indicators_for_symbols(symbols, result)
    if not snapshots:
        logger.warning("No indicator snapshots computed — no alerts will be generated")
        return result

    snap_by_sym = {s["symbol"]: s for s in snapshots}
    computed    = list(snap_by_sym.keys())

    # 4. Load supporting data
    priors      = _get_prior_snapshots(computed)
    market_data = _get_market_data(computed)
    existing    = _get_existing_alerts_today(computed, today)

    # 5. Evaluate conditions
    new_alerts: list[dict] = []
    total_skipped = 0
    for symbol, snap in snap_by_sym.items():
        fired, skipped = _evaluate_conditions(
            snap=snap,
            prior=priors.get(symbol),
            market_data=market_data.get(symbol),
            existing=existing,
            today=today,
        )
        new_alerts.extend(fired)
        total_skipped += skipped

    result.alerts_skipped_dedup = total_skipped

    # 6. Insert new alerts
    if new_alerts:
        get_client().table("alerts").insert(new_alerts).execute()
    result.alerts_created = len(new_alerts)

    logger.info(
        "Scan complete — %d symbol(s), %d OHLCV fetched, %d cached, "
        "%d indicators, %d alert(s) created, %d dedup-skipped",
        result.symbols_scanned,
        result.ohlcv_fetched,
        result.ohlcv_cached,
        result.indicators_computed,
        result.alerts_created,
        result.alerts_skipped_dedup,
    )
    return result
