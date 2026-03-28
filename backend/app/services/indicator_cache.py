"""
Upsert computed indicator snapshots into indicator_snapshots table.
"""

import logging
from app.database import get_client

logger = logging.getLogger(__name__)


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
