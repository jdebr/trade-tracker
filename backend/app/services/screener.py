"""
Two-pass screener.

Pass 1 — broad filter (no API calls, uses tickers table metadata):
  - avg_volume > 1,000,000
  - 15 ≤ last_price ≤ 500
  - is_etf = False

Pass 2 — signal filter (reads indicator_snapshots + ohlcv_cache):
  - bb_squeeze = True
  - 35 ≤ rsi_14 ≤ 65
  - close > ema_50  (above primary trend)
  - volume_expansion: avg(last 3d volume) > avg(last 20d volume)

Each passing signal adds 1 to signal_score (max 4).
Results are ranked by signal_score descending and written to screener_results.

Public API:
    run_screener() -> tuple[datetime, list[dict]]
    get_latest_results(limit) -> list[dict]
    get_results_by_run(run_at_iso) -> list[dict]
"""

import logging
from datetime import datetime, timezone
from app.database import get_client

logger = logging.getLogger(__name__)

# Pass 1 thresholds
MIN_AVG_VOLUME = 1_000_000
MIN_PRICE = 15.0
MAX_PRICE = 500.0

# Pass 2 thresholds
RSI_LOW  = 35.0
RSI_HIGH = 65.0


# ---------------------------------------------------------------------------
# Pass 1
# ---------------------------------------------------------------------------

def pass1_filter() -> list[str]:
    """
    Query the tickers table and return symbols that pass all three criteria.
    Symbols with NULL avg_volume or last_price are excluded (not yet populated).
    """
    result = (
        get_client()
        .table("tickers")
        .select("symbol")
        .eq("is_etf", False)
        .gt("avg_volume", MIN_AVG_VOLUME)
        .gte("last_price", MIN_PRICE)
        .lte("last_price", MAX_PRICE)
        .execute()
    )
    symbols = [row["symbol"] for row in result.data]
    logger.info("Pass 1: %d survivors", len(symbols))
    return symbols


# ---------------------------------------------------------------------------
# Pass 2 helpers
# ---------------------------------------------------------------------------

def _get_indicators(symbols: list[str]) -> dict[str, dict]:
    """
    Return the most-recent indicator snapshot for each symbol as a dict
    keyed by symbol.  Symbols with no snapshot are omitted.
    """
    if not symbols:
        return {}

    # Fetch all matching symbols; take the most-recent date per symbol.
    result = (
        get_client()
        .table("indicator_snapshots")
        .select("symbol,date,rsi_14,bb_squeeze,ema_50")
        .in_("symbol", symbols)
        .order("date", desc=True)
        .execute()
    )

    # Keep only the most-recent row per symbol.
    snapshots: dict[str, dict] = {}
    for row in result.data:
        sym = row["symbol"]
        if sym not in snapshots:
            snapshots[sym] = row
    return snapshots


def _get_recent_volumes(symbols: list[str]) -> dict[str, dict]:
    """
    For each symbol, return avg of last 3d and last 20d volumes from ohlcv_cache.
    Result: {symbol: {"vol_3d": float, "vol_20d": float, "last_close": float}}
    """
    if not symbols:
        return {}

    volumes: dict[str, dict] = {}
    for symbol in symbols:
        result = (
            get_client()
            .table("ohlcv_cache")
            .select("volume,close")
            .eq("symbol", symbol)
            .order("date", desc=True)
            .limit(20)
            .execute()
        )
        bars = result.data
        if not bars:
            continue

        vols = [b["volume"] for b in bars]
        last_close = float(bars[0]["close"])
        vol_3d  = sum(vols[:3]) / min(3, len(vols))
        vol_20d = sum(vols)     / len(vols)

        volumes[symbol] = {
            "vol_3d":     vol_3d,
            "vol_20d":    vol_20d,
            "last_close": last_close,
        }
    return volumes


# ---------------------------------------------------------------------------
# Pass 2
# ---------------------------------------------------------------------------

def pass2_score(symbols: list[str]) -> list[dict]:
    """
    Apply signal filters to each symbol and return a list of scored candidate
    dicts, sorted by signal_score descending.  Symbols with no indicator
    snapshot are skipped.
    """
    indicators = _get_indicators(symbols)
    vol_data   = _get_recent_volumes(symbols)

    candidates = []
    for symbol in symbols:
        snap = indicators.get(symbol)
        if not snap:
            logger.debug("%s: no indicator snapshot — skipping Pass 2", symbol)
            continue

        vol = vol_data.get(symbol, {})
        last_close = vol.get("last_close")
        ema_50     = snap.get("ema_50")
        rsi_14     = snap.get("rsi_14")
        bb_squeeze = snap.get("bb_squeeze")

        # Evaluate each signal
        sig_bb_squeeze     = bool(bb_squeeze) if bb_squeeze is not None else False
        sig_rsi_in_range   = (RSI_LOW <= rsi_14 <= RSI_HIGH) if rsi_14 is not None else False
        sig_above_ema50    = (last_close > ema_50) if (last_close and ema_50) else False
        sig_vol_expansion  = (vol["vol_3d"] > vol["vol_20d"]) if vol else False

        score = sum([sig_bb_squeeze, sig_rsi_in_range, sig_above_ema50, sig_vol_expansion])

        candidates.append({
            "symbol":           symbol,
            "signal_score":     score,
            "bb_squeeze":       sig_bb_squeeze,
            "rsi_14":           float(rsi_14) if rsi_14 is not None else None,
            "rsi_in_range":     sig_rsi_in_range,
            "above_ema50":      sig_above_ema50,
            "volume_expansion": sig_vol_expansion,
            "close_price":      last_close,
        })

    # Rank by score descending, then alphabetically as tiebreaker.
    candidates.sort(key=lambda c: (-c["signal_score"], c["symbol"]))
    for i, c in enumerate(candidates):
        c["rank"] = i + 1

    logger.info("Pass 2: %d candidates scored (top score: %d)",
                len(candidates),
                candidates[0]["signal_score"] if candidates else 0)
    return candidates


# ---------------------------------------------------------------------------
# Persist + retrieve
# ---------------------------------------------------------------------------

def save_results(candidates: list[dict], run_at: datetime) -> int:
    """
    Insert screener_results rows for this run.
    Returns the number of rows inserted.
    """
    if not candidates:
        return 0

    rows = []
    for c in candidates:
        rows.append({
            "run_at":           run_at.isoformat(),
            "symbol":           c["symbol"],
            "rank":             c["rank"],
            "signal_score":     c["signal_score"],
            "bb_squeeze":       c.get("bb_squeeze"),
            "rsi_14":           c.get("rsi_14"),
            "rsi_in_range":     c.get("rsi_in_range"),
            "above_ema50":      c.get("above_ema50"),
            "volume_expansion": c.get("volume_expansion"),
            "close_price":      c.get("close_price"),
        })

    result = get_client().table("screener_results").insert(rows).execute()
    count = len(result.data) if result.data else 0
    logger.info("Saved %d screener_results rows for run_at=%s", count, run_at.isoformat())
    return count


def get_latest_results(limit: int = 50) -> list[dict]:
    """Return the most recent run's results, ordered by rank."""
    # Find the most recent run_at.
    latest = (
        get_client()
        .table("screener_results")
        .select("run_at")
        .order("run_at", desc=True)
        .limit(1)
        .execute()
    )
    if not latest.data:
        return []

    run_at = latest.data[0]["run_at"]
    return _results_for_run(run_at, limit)


def get_results_by_run(run_at_iso: str, limit: int = 100) -> list[dict]:
    """Return results for a specific run identified by its run_at ISO string."""
    return _results_for_run(run_at_iso, limit)


def _results_for_run(run_at: str, limit: int) -> list[dict]:
    result = (
        get_client()
        .table("screener_results")
        .select("*")
        .eq("run_at", run_at)
        .order("rank")
        .limit(limit)
        .execute()
    )
    return result.data


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def _bootstrap_symbols() -> list[str]:
    """
    Return all non-ETF ticker symbols from the tickers table.
    Used as a fallback when Pass 1 returns nothing (cold-start / no metadata yet).
    """
    result = (
        get_client()
        .table("tickers")
        .select("symbol")
        .eq("is_etf", False)
        .execute()
    )
    return [r["symbol"] for r in result.data]


def _fetch_and_compute(symbols: list[str]) -> None:
    """Fetch OHLCV and compute indicators for a list of symbols."""
    from app.services.market_data import fetch_ohlcv
    from app.services.ohlcv_cache import upsert_bars
    from app.services.indicators import compute_indicators
    from app.services.universe import update_ticker_metadata

    for symbol in symbols:
        try:
            bars = fetch_ohlcv(symbol)
            upsert_bars(bars)
        except Exception as exc:
            logger.warning("OHLCV fetch failed for %s: %s", symbol, exc)
        try:
            compute_indicators(symbol)
        except Exception as exc:
            logger.warning("Indicator compute failed for %s: %s", symbol, exc)

    try:
        update_ticker_metadata(symbols)
    except Exception as exc:
        logger.warning("Metadata update failed: %s", exc)


def run_screener() -> tuple[datetime, list[dict]]:
    """
    Full screener run:
      1. Pass 1 — filter tickers table by volume/price metadata
         If no metadata exists yet (cold start), fall back to all non-ETF tickers
         and fetch OHLCV + compute indicators first.
      2. Fetch OHLCV + compute indicators for Pass 1 survivors (ensures fresh data)
      3. Pass 2 — score survivors against indicator snapshots
      4. Save results to screener_results

    Returns (run_at, candidates).
    """
    run_at = datetime.now(timezone.utc)

    pass1_survivors = pass1_filter()
    if not pass1_survivors:
        logger.warning("Pass 1 returned no survivors — attempting cold-start bootstrap")
        all_symbols = _bootstrap_symbols()
        if not all_symbols:
            logger.error("Tickers table is empty — run sync-universe first")
            return run_at, []
        logger.info("Cold-start: fetching OHLCV + indicators for %d tickers", len(all_symbols))
        _fetch_and_compute(all_symbols)
        pass1_survivors = pass1_filter()
        if not pass1_survivors:
            logger.warning("Pass 1 still empty after bootstrap — check OHLCV data")
            return run_at, []

    # Ensure fresh OHLCV + indicators for Pass 1 survivors before scoring
    _fetch_and_compute(pass1_survivors)

    candidates = pass2_score(pass1_survivors)
    save_results(candidates, run_at)

    return run_at, candidates
