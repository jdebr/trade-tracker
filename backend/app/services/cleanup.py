"""
Storage retention / cleanup.

The trade record is sacred: `positions` and `position_events` are the analytics
substrate (every report reads from them, and each position carries its own
`entry_signals` snapshot), so this job never touches them. `screener_results` is
also left alone — it is the low-volume filter-tuning dataset that feeds alert
tuning (milestone 16).

What we prune are the re-derivable caches and stale noise:

  - ohlcv_cache / indicator_snapshots — the raw price cache and computed
    indicators. Both are re-fetchable/re-computable, and the app only ever reads
    the most recent bars per symbol. Indicator computation needs the latest
    BB_SQUEEZE_WINDOW + 50 = 302 trading days (~14 calendar months), so the
    retention window sits comfortably above that (18 months) — a missed cleanup
    run can never clip the history indicators depend on.
  - alerts — opportunity alerts are a journaling convenience, not source of
    truth. Old ones are pruned, EXCEPT any alert still referenced by a surviving
    position or position_event (provenance FKs are ON DELETE SET NULL, so
    deleting a referenced alert would quietly erase a kept trade's provenance).

Cutoffs are absolute dates, so the job is idempotent — safe to re-run any number
of times, and a missed run simply catches up on the next one. Deletes are
batched to avoid long locks / PostgREST statement timeouts.
"""

import logging
from datetime import date, timedelta

from app.database import get_client

logger = logging.getLogger(__name__)

# --- Retention windows -------------------------------------------------------
# OHLCV / indicator floor: compute_indicators() reads BB_SQUEEZE_WINDOW (252) +
# 50 = 302 trading days ≈ 14 calendar months. Keep well above that.
OHLCV_RETENTION_DAYS     = 548   # ~18 months
INDICATOR_RETENTION_DAYS = 548   # ~18 months
ALERT_RETENTION_DAYS     = 90    # ~3 months of journaling history

# Delete in chunks to keep statements small and locks short.
DELETE_BATCH_SIZE = 500


def _delete_by_ids(table: str, ids: list[str]) -> int:
    """Delete rows by primary key in batches. Returns the number deleted."""
    deleted = 0
    for i in range(0, len(ids), DELETE_BATCH_SIZE):
        chunk = ids[i:i + DELETE_BATCH_SIZE]
        result = get_client().table(table).delete().in_("id", chunk).execute()
        deleted += len(result.data or [])
    return deleted


def _prune_by_date(table: str, date_col: str, cutoff: str) -> int:
    """
    Delete every row in `table` whose `date_col` is strictly before `cutoff`
    (an ISO date/timestamp string), a batch at a time until none remain.
    """
    total = 0
    while True:
        rows = (
            get_client()
            .table(table)
            .select("id")
            .lt(date_col, cutoff)
            .limit(DELETE_BATCH_SIZE)
            .execute()
        ).data
        if not rows:
            break
        deleted = _delete_by_ids(table, [r["id"] for r in rows])
        total += deleted
        if deleted == 0:
            # Nothing was removed (e.g. permissions) — stop rather than spin.
            logger.warning("Cleanup made no progress on %s; stopping early", table)
            break
    return total


def _referenced_alert_ids() -> set[str]:
    """
    Alert ids that a surviving position or position_event points at via its
    provenance FK. These must never be pruned — the FK is ON DELETE SET NULL,
    so deleting the alert would silently null out a kept trade's provenance.
    """
    referenced: set[str] = set()
    for table in ("positions", "position_events"):
        rows = get_client().table(table).select("alert_id").execute().data
        referenced.update(r["alert_id"] for r in rows if r.get("alert_id"))
    return referenced


def prune_alerts(cutoff: str) -> int:
    """
    Delete alerts older than `cutoff` (by triggered_at), except those still
    referenced by a position or position_event.
    """
    referenced = _referenced_alert_ids()

    stale_ids: list[str] = []
    page = 0
    PAGE_SIZE = 1000
    while True:
        rows = (
            get_client()
            .table("alerts")
            .select("id")
            .lt("triggered_at", cutoff)
            .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
            .execute()
        ).data
        if not rows:
            break
        stale_ids.extend(r["id"] for r in rows)
        if len(rows) < PAGE_SIZE:
            break
        page += 1

    to_delete = [aid for aid in stale_ids if aid not in referenced]
    return _delete_by_ids("alerts", to_delete)


def run_cleanup() -> dict:
    """
    Prune the re-derivable caches and stale alerts. Idempotent.
    Returns a per-table count of rows deleted.
    """
    today = date.today()
    ohlcv_cutoff = (today - timedelta(days=OHLCV_RETENTION_DAYS)).isoformat()
    ind_cutoff   = (today - timedelta(days=INDICATOR_RETENTION_DAYS)).isoformat()
    alert_cutoff = (today - timedelta(days=ALERT_RETENTION_DAYS)).isoformat()

    summary = {
        "ohlcv_deleted":      _prune_by_date("ohlcv_cache", "date", ohlcv_cutoff),
        "indicators_deleted": _prune_by_date("indicator_snapshots", "date", ind_cutoff),
        "alerts_deleted":     prune_alerts(alert_cutoff),
    }
    logger.info("Cleanup complete: %s", summary)
    return summary
