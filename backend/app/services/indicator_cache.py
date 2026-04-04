"""
Upsert computed indicator snapshots into indicator_snapshots table.
"""

import logging
from app.database import get_client

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
    """
    if not symbols:
        return []

    result = (
        get_client()
        .table("indicator_snapshots")
        .select("*")
        .in_("symbol", symbols)
        .order("date", desc=True)
        .execute()
    )

    seen: set[str] = set()
    rows: list[dict] = []
    for row in result.data:
        sym = row["symbol"]
        if sym not in seen:
            seen.add(sym)
            rows.append(row)
    return rows


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
