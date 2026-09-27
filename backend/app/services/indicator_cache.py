"""
Upsert computed indicator snapshots into indicator_snapshots table.
"""

import logging
from app.database import get_client, rpc_per_symbol

logger = logging.getLogger(__name__)


def get_indicator_history(symbol: str, limit: int = 252) -> list[dict]:
    """
    Return up to `limit` indicator snapshot rows for a symbol,
    ordered oldest → newest (ready for chart overlay consumption).
    """
    result = (
        get_client()
        .table("indicator_snapshots")
        .select("symbol,date,bb_upper,bb_middle,bb_lower,ema_8,ema_21,ema_50")
        .eq("symbol", symbol.upper())
        .order("date", desc=True)
        .limit(limit)
        .execute()
    )
    return list(reversed(result.data))


def get_latest_snapshots(symbols: list[str]) -> list[dict]:
    """
    Return the most-recent indicator snapshot for each requested symbol.
    Symbols with no snapshot are omitted from the result.

    Reduced in Postgres (one row per symbol, migration 004): fetching history
    and de-duplicating here hit PostgREST's 1000-row cap, which silently
    dropped symbols whose newest snapshot wasn't among the globally newest rows.
    """
    if not symbols:
        return []
    return rpc_per_symbol("latest_indicator_snapshots", symbols)


def get_prior_snapshots(symbols: list[str]) -> dict[str, dict]:
    """{SYMBOL: second-newest snapshot} (crossover detection); symbols with fewer
    than two snapshots are omitted. One row per symbol, reduced in Postgres."""
    if not symbols:
        return {}
    return {r["symbol"]: r for r in rpc_per_symbol("prior_indicator_snapshots", symbols)}


def upsert_snapshots(snapshots: list[dict]) -> int:
    """
    Upsert a list of indicator snapshot dicts.
    The table has UNIQUE(symbol, date) — re-running for the same date updates
    the existing row rather than inserting a duplicate.
    Returns the number of rows upserted.
    """
    if not snapshots:
        return 0

    result = (
        get_client()
        .table("indicator_snapshots")
        .upsert(snapshots, on_conflict="symbol,date")
        .execute()
    )
    count = len(result.data) if result.data else 0
    logger.info("Upserted %d indicator snapshots", count)
    return count
