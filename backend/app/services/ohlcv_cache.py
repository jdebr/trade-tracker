"""
OHLCV cache layer — sits between the market data fetchers and the rest of
the app.

Public API:
    is_cache_fresh(symbol) -> bool
    bulk_check_freshness(symbols) -> dict[str, bool]
    get_ohlcv_summary(symbols, window) -> dict[str, dict]  (one row per symbol)
    get_latest_closes(symbols) -> dict[str, float]
    upsert_bars(bars)          -> int (rows upserted)
    get_cached_bars(symbol)    -> list[dict]
    latest_fetch_at(symbols)   -> str | None (newest fetched_at across symbols)
"""

import logging
from datetime import date, datetime, timedelta, timezone
from app.database import get_client, rpc_per_symbol

logger = logging.getLogger(__name__)

# A symbol's cache is considered fresh if its most recent bar is today or
# yesterday (yesterday covers the case where today's close hasn't happened yet).
_STALE_THRESHOLD_DAYS = 1


def _latest_trading_day() -> date:
    """Return today or the most recent weekday (Mon–Fri)."""
    today = date.today()
    # Roll back from Saturday (5) or Sunday (6)
    offset = max(0, today.weekday() - 4)
    return today - timedelta(days=offset)


def is_cache_fresh(symbol: str) -> bool:
    """
    Return True if the newest bar for this symbol is recent enough that we
    don't need to fetch from a market data API.
    """
    result = (
        get_client()
        .table("ohlcv_cache")
        .select("date")
        .eq("symbol", symbol.upper())
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    if not result.data:
        return False

    latest = date.fromisoformat(result.data[0]["date"])
    cutoff = _latest_trading_day() - timedelta(days=_STALE_THRESHOLD_DAYS)
    return latest >= cutoff


def bulk_check_freshness(symbols: list[str]) -> dict[str, bool]:
    """
    Return a mapping of symbol → is_cache_fresh for all requested symbols, in
    one round trip per 500 symbols. Keys keep the caller's spelling.
    """
    last = {s: r["last_date"] for s, r in get_ohlcv_summary(symbols, window=1).items()}
    cutoff = _latest_trading_day() - timedelta(days=_STALE_THRESHOLD_DAYS)
    return {
        sym: sym.upper() in last and date.fromisoformat(last[sym.upper()]) >= cutoff
        for sym in symbols
    }


def get_ohlcv_summary(symbols: list[str], window: int = 20) -> dict[str, dict]:
    """
    {SYMBOL: summary} over each symbol's trailing `window` bars, reduced in
    Postgres (migration 004's `ohlcv_summary`) so the 1000-row response cap
    can't truncate it. Summary keys: last_date (ISO str), last_close, bar_count,
    vol_3d, vol_avg (floats), last_fetched_at. Symbols with no bars are omitted.
    """
    if not symbols:
        return {}
    out: dict[str, dict] = {}
    for row in rpc_per_symbol("ohlcv_summary", symbols, p_window=window):
        out[row["symbol"]] = {
            "last_date":       row["last_date"],
            "last_close":      _float(row["last_close"]),
            "bar_count":       row["bar_count"],
            "vol_3d":          _float(row["vol_3d"]),
            "vol_avg":         _float(row["vol_avg"]),
            "last_fetched_at": row["last_fetched_at"],
        }
    return out


def _float(v) -> float | None:
    return float(v) if v is not None else None


def upsert_bars(bars: list[dict]) -> int:
    """
    Upsert a list of OHLCV bar dicts into ohlcv_cache.
    The table has UNIQUE(symbol, date) so duplicate rows are updated in place.
    Returns the number of rows upserted.
    """
    if not bars:
        return 0

    # Stamp every write: fetched_at only defaults on INSERT, so without this a
    # re-fetched bar (e.g. today's, refreshed intraday) would keep its first
    # fetch time and "last update" would lag behind the real last pull.
    now = datetime.now(timezone.utc).isoformat()
    bars = [{**b, "fetched_at": now} for b in bars]

    result = (
        get_client()
        .table("ohlcv_cache")
        .upsert(bars, on_conflict="symbol,date")
        .execute()
    )
    count = len(result.data) if result.data else 0
    logger.info("Upserted %d OHLCV bars", count)
    return count


def get_cached_bars(symbol: str, limit: int = 200) -> list[dict]:
    """
    Retrieve the most recent `limit` OHLCV bars for a symbol from cache,
    ordered oldest → newest (ready for pandas/TA consumption).
    """
    result = (
        get_client()
        .table("ohlcv_cache")
        .select("*")
        .eq("symbol", symbol.upper())
        .order("date", desc=True)
        .limit(limit)
        .execute()
    )
    return list(reversed(result.data))


def get_latest_closes(symbols: list[str]) -> dict[str, float]:
    """
    Return {symbol: latest close} for the requested symbols, one row per symbol.

    Symbols with no cached bars are omitted. Used wherever the app needs a current
    price for arbitrary symbols — the watchlist price column, entry prefill in the
    exit builder, exit prefill on close.
    """
    return {s: r["last_close"] for s, r in get_ohlcv_summary(symbols, window=1).items()}


def latest_fetch_at(symbols: list[str], lookback_days: int = 10) -> str | None:
    """
    When market data was last actually pulled for any of `symbols` — the newest
    `fetched_at` among their recent bars. Derived from the data itself, so it
    survives backend restarts (unlike the scheduler's in-memory last-run time).
    The (symbol, date) index keeps this to a handful of rows.
    """
    if not symbols:
        return None
    since = (date.today() - timedelta(days=lookback_days)).isoformat()
    result = (
        get_client()
        .table("ohlcv_cache")
        .select("fetched_at")
        .in_("symbol", [s.upper() for s in symbols])
        .gte("date", since)
        .order("fetched_at", desc=True)
        .limit(1)
        .execute()
    )
    return result.data[0]["fetched_at"] if result.data else None
