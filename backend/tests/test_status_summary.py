"""
Tests for GET /status/summary (public, no auth required).

Criteria:
 1. Returns 200 with expected top-level keys
 2. scheduler block contains expected keys
 3. unacknowledged_alerts is an integer
 4. watchlist_size is an integer
 5. top_screener_candidates is a list (may be empty)
"""

from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

FAKE_STATUS = {
    "enabled": True,
    "paused": False,
    "pause_until": None,
    "last_run_at": "2026-06-09T16:15:00+00:00",
    "next_run": "2026-06-10T16:15:00+00:00",
    "schedule": "Intraday 5×/day · EOD 16:15 ET · Mon–Fri",
    "last_run_result": {"symbols_scanned": 5, "alerts_created": 2},
    "td_api_usage": {"current_usage": 42, "plan_limit": 800},
    "cooldown_minutes": 60,
    "seconds_until_cooldown_expires": None,
}

FAKE_SCREENER = [
    {
        "symbol": "AAPL",
        "signal_score": 4,
        "bb_squeeze": True,
        "rsi_in_range": True,
        "above_ema50": True,
        "volume_expansion": True,
        "run_at": "2026-06-07T23:00:00+00:00",
    }
]


def _mock_db(alert_count=3, watchlist_count=5, screener_data=None):
    """Return a mock Supabase client wired to return predictable data."""
    if screener_data is None:
        screener_data = FAKE_SCREENER

    def make_chain(count=None, data=None):
        chain = MagicMock()
        chain.select.return_value = chain
        chain.eq.return_value = chain
        chain.order.return_value = chain
        chain.limit.return_value = chain
        result = MagicMock()
        result.count = count
        result.data = data or []
        chain.execute.return_value = result
        return chain

    db = MagicMock()
    call_count = 0

    def table_side_effect(name):
        nonlocal call_count
        call_count += 1
        if name == "alerts":
            return make_chain(count=alert_count)
        if name == "watchlist":
            return make_chain(count=watchlist_count)
        if name == "screener_results":
            return make_chain(data=screener_data)
        return make_chain()

    db.table.side_effect = table_side_effect
    return db


# ---------------------------------------------------------------------------
# 1. Returns 200 with expected top-level keys
# ---------------------------------------------------------------------------

def test_summary_returns_200_with_top_level_keys():
    with patch("app.routers.status.sched_svc.get_status", return_value=FAKE_STATUS), \
         patch("app.routers.status.get_client", return_value=_mock_db()):
        response = client.get("/status/summary")

    assert response.status_code == 200
    data = response.json()
    assert "scheduler" in data
    assert "unacknowledged_alerts" in data
    assert "watchlist_size" in data
    assert "top_screener_candidates" in data


# ---------------------------------------------------------------------------
# 2. scheduler block contains expected keys
# ---------------------------------------------------------------------------

def test_summary_scheduler_block_has_expected_keys():
    with patch("app.routers.status.sched_svc.get_status", return_value=FAKE_STATUS), \
         patch("app.routers.status.get_client", return_value=_mock_db()):
        data = client.get("/status/summary").json()

    sched = data["scheduler"]
    for key in ("enabled", "paused", "last_run_at", "next_run", "schedule", "td_api_usage"):
        assert key in sched, f"Missing key: {key}"


# ---------------------------------------------------------------------------
# 3. unacknowledged_alerts is an integer
# ---------------------------------------------------------------------------

def test_summary_unacknowledged_alerts_is_integer():
    with patch("app.routers.status.sched_svc.get_status", return_value=FAKE_STATUS), \
         patch("app.routers.status.get_client", return_value=_mock_db(alert_count=7)):
        data = client.get("/status/summary").json()

    assert isinstance(data["unacknowledged_alerts"], int)
    assert data["unacknowledged_alerts"] == 7


# ---------------------------------------------------------------------------
# 4. watchlist_size is an integer
# ---------------------------------------------------------------------------

def test_summary_watchlist_size_is_integer():
    with patch("app.routers.status.sched_svc.get_status", return_value=FAKE_STATUS), \
         patch("app.routers.status.get_client", return_value=_mock_db(watchlist_count=12)):
        data = client.get("/status/summary").json()

    assert isinstance(data["watchlist_size"], int)
    assert data["watchlist_size"] == 12


# ---------------------------------------------------------------------------
# 5. top_screener_candidates is a list
# ---------------------------------------------------------------------------

def test_summary_top_screener_candidates_is_list():
    with patch("app.routers.status.sched_svc.get_status", return_value=FAKE_STATUS), \
         patch("app.routers.status.get_client", return_value=_mock_db()):
        data = client.get("/status/summary").json()

    assert isinstance(data["top_screener_candidates"], list)
    assert data["top_screener_candidates"][0]["symbol"] == "AAPL"
