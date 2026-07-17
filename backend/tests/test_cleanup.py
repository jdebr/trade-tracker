"""
Tests for the storage retention cleanup service.

Uses a small in-memory fake of the Supabase client so the real cleanup logic —
date cutoffs, batched deletes, FK protection, idempotency — runs against actual
mutable table state rather than a fixed canned response.
"""

from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.services import cleanup
from app.services.cleanup import (
    ALERT_RETENTION_DAYS,
    OHLCV_RETENTION_DAYS,
    run_cleanup,
)


# ---------------------------------------------------------------------------
# In-memory Supabase fake
# ---------------------------------------------------------------------------

class FakeQuery:
    """A chainable query over one in-memory table (a list of dict rows)."""

    def __init__(self, rows: list[dict]):
        self._rows = rows
        self._op = "select"
        self._filters: list[tuple] = []
        self._limit: int | None = None
        self._range: tuple[int, int] | None = None

    def select(self, *_a, **_k):
        self._op = "select"
        return self

    def delete(self):
        self._op = "delete"
        return self

    def lt(self, col, val):
        self._filters.append(("lt", col, val))
        return self

    def in_(self, col, vals):
        self._filters.append(("in", col, list(vals)))
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self._limit = n
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def _match(self, row) -> bool:
        for kind, col, val in self._filters:
            if kind == "lt" and not (str(row.get(col)) < str(val)):
                return False
            if kind == "in" and row.get(col) not in val:
                return False
        return True

    def execute(self):
        matched = [r for r in self._rows if self._match(r)]
        if self._op == "delete":
            for r in matched:
                self._rows.remove(r)
            return SimpleNamespace(data=[dict(r) for r in matched])
        # select
        result = matched
        if self._range is not None:
            start, end = self._range
            result = matched[start:end + 1]
        elif self._limit is not None:
            result = matched[:self._limit]
        return SimpleNamespace(data=[dict(r) for r in result])


class FakeClient:
    def __init__(self, store: dict[str, list[dict]]):
        self._store = store

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self._store.setdefault(name, []))


@pytest.fixture
def store():
    """A fresh in-memory DB, patched in for the duration of the test."""
    data: dict[str, list[dict]] = {
        "ohlcv_cache": [],
        "indicator_snapshots": [],
        "alerts": [],
        "positions": [],
        "position_events": [],
    }
    with patch.object(cleanup, "get_client", return_value=FakeClient(data)):
        yield data


def _days_ago(n: int) -> str:
    return (date.today() - timedelta(days=n)).isoformat()


# ---------------------------------------------------------------------------
# OHLCV / indicator retention
# ---------------------------------------------------------------------------

def test_prunes_ohlcv_older_than_window_keeps_recent(store):
    store["ohlcv_cache"] = [
        {"id": "old-1", "date": _days_ago(OHLCV_RETENTION_DAYS + 30)},
        {"id": "old-2", "date": _days_ago(OHLCV_RETENTION_DAYS + 1)},
        {"id": "recent", "date": _days_ago(OHLCV_RETENTION_DAYS - 30)},
        {"id": "today", "date": _days_ago(0)},
    ]

    summary = run_cleanup()

    assert summary["ohlcv_deleted"] == 2
    remaining = {r["id"] for r in store["ohlcv_cache"]}
    assert remaining == {"recent", "today"}


def test_prunes_indicator_snapshots(store):
    store["indicator_snapshots"] = [
        {"id": "stale", "date": _days_ago(OHLCV_RETENTION_DAYS + 5)},
        {"id": "fresh", "date": _days_ago(10)},
    ]

    summary = run_cleanup()

    assert summary["indicators_deleted"] == 1
    assert {r["id"] for r in store["indicator_snapshots"]} == {"fresh"}


def test_batched_delete_removes_all_over_multiple_chunks(store):
    # More rows than one DELETE_BATCH_SIZE, all stale — must all go.
    n = cleanup.DELETE_BATCH_SIZE * 2 + 7
    store["ohlcv_cache"] = [
        {"id": f"row-{i}", "date": _days_ago(OHLCV_RETENTION_DAYS + 100)}
        for i in range(n)
    ]

    summary = run_cleanup()

    assert summary["ohlcv_deleted"] == n
    assert store["ohlcv_cache"] == []


# ---------------------------------------------------------------------------
# Alert retention + FK protection
# ---------------------------------------------------------------------------

def test_prunes_stale_alerts_keeps_recent(store):
    store["alerts"] = [
        {"id": "a-old", "triggered_at": _days_ago(ALERT_RETENTION_DAYS + 10)},
        {"id": "a-new", "triggered_at": _days_ago(ALERT_RETENTION_DAYS - 10)},
    ]

    summary = run_cleanup()

    assert summary["alerts_deleted"] == 1
    assert {r["id"] for r in store["alerts"]} == {"a-new"}


def test_protects_alert_referenced_by_position(store):
    store["alerts"] = [
        {"id": "a-referenced", "triggered_at": _days_ago(ALERT_RETENTION_DAYS + 50)},
        {"id": "a-orphan", "triggered_at": _days_ago(ALERT_RETENTION_DAYS + 50)},
    ]
    # A surviving position points at a-referenced via its provenance FK.
    store["positions"] = [{"alert_id": "a-referenced"}]

    summary = run_cleanup()

    assert summary["alerts_deleted"] == 1
    remaining = {r["id"] for r in store["alerts"]}
    assert remaining == {"a-referenced"}


def test_protects_alert_referenced_by_position_event(store):
    store["alerts"] = [
        {"id": "a-evt", "triggered_at": _days_ago(ALERT_RETENTION_DAYS + 50)},
    ]
    store["position_events"] = [{"alert_id": "a-evt"}]

    summary = run_cleanup()

    assert summary["alerts_deleted"] == 0
    assert {r["id"] for r in store["alerts"]} == {"a-evt"}


# ---------------------------------------------------------------------------
# Safety properties
# ---------------------------------------------------------------------------

def test_idempotent_second_run_deletes_nothing(store):
    store["ohlcv_cache"] = [
        {"id": "old", "date": _days_ago(OHLCV_RETENTION_DAYS + 5)},
        {"id": "new", "date": _days_ago(5)},
    ]
    store["alerts"] = [
        {"id": "old-alert", "triggered_at": _days_ago(ALERT_RETENTION_DAYS + 5)},
    ]

    first = run_cleanup()
    assert first["ohlcv_deleted"] == 1
    assert first["alerts_deleted"] == 1

    second = run_cleanup()
    assert second == {"ohlcv_deleted": 0, "indicators_deleted": 0, "alerts_deleted": 0}


def test_never_touches_positions_or_screener_results(store):
    store["positions"] = [{"id": "p1", "alert_id": None}]
    store["position_events"] = [{"id": "e1", "alert_id": None}]
    store["screener_results"] = [{"id": "s1", "run_at": _days_ago(9999)}]

    run_cleanup()

    assert len(store["positions"]) == 1
    assert len(store["position_events"]) == 1
    assert len(store["screener_results"]) == 1
