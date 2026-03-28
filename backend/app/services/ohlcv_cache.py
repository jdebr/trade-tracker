"""
OHLCV cache layer — sits between the market data fetchers and the rest of
the app.

Public API:
    is_cache_fresh(symbol) -> bool
    bulk_check_freshness(symbols) -> dict[str, bool]
    upsert_bars(bars)          -> int (rows upserted)
    get_cached_bars(symbol)    -> list[dict]
"""

import logging
from datetime import date, timedelta
from app.database import get_client

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
    Return a mapping of symbol → is_cache_fresh for all requested symbols.
    Uses a single query per symbol (Supabase free tier has no GROUP BY max
    support via the REST API).
    """
    return {sym: is_cache_fresh(sym) for sym in symbols}


def upsert_bars(bars: list[dict]) -> int:
    """
    Upsert a list of OHLCV bar dicts into ohlcv_cache.
    The table has UNIQUE(symbol, date) so duplicate rows are updated in place.
    Returns the number of rows upserted.
    """
    if not bars:
        return 0

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
