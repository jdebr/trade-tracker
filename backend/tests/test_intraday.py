"""
Tests for the intraday quote poller (app/services/intraday.py).

Criteria:
 1.  evaluate_intraday_conditions: price below bb_lower fires price_below_lower_bb
 2.  evaluate_intraday_conditions: price above bb_upper fires price_above_upper_bb
 3.  evaluate_intraday_conditions: price below ema_8 fires price_below_ema8
 4.  evaluate_intraday_conditions: price above ema_8 fires price_above_ema8
 5.  evaluate_intraday_conditions: no conditions fire when price is inside bands/ema
 6.  evaluate_intraday_conditions: dedup skips an already-existing (symbol, alert_type)
 7.  run_intraday_poll: fetches quotes, evaluates conditions, inserts new alerts
 8.  run_intraday_poll: symbol with no snapshot is skipped gracefully (no crash)
 9.  run_intraday_poll: individual quote fetch failures are logged and skipped (job continues)
10.  run_intraday_poll: empty watchlist exits early and returns zero counts
11.  run_intraday_poll: returns summary dict with expected keys
12.  Scheduler registers five intraday poll jobs at the correct ET times
"""

from datetime import date
from unittest.mock import MagicMock, patch, call
import asyncio
import pytest

import app.services.scheduler as sched_svc


def setup_function():
    """Reset scheduler state before each test."""
    sched_svc._scheduler       = None
    sched_svc._pause_until     = None
    sched_svc._last_run_at     = None
    sched_svc._last_run_result = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _snap(symbol="AAPL", bb_upper=155.0, bb_lower=145.0, ema_8=150.0):
    return {
        "symbol":   symbol,
        "date":     "2026-04-01",
        "bb_upper": bb_upper,
        "bb_lower": bb_lower,
        "ema_8":    ema_8,
    }


# ---------------------------------------------------------------------------
# 1–6: evaluate_intraday_conditions
# ---------------------------------------------------------------------------

def test_price_below_lower_bb_fires_alert():
    from app.services.intraday import evaluate_intraday_conditions

    alerts, skipped = evaluate_intraday_conditions(
        symbol="AAPL",
        current_price=144.0,   # below bb_lower=145
        snapshot=_snap(),
        existing=set(),
        today=date(2026, 4, 1),
    )

    types = {a["alert_type"] for a in alerts}
    assert "price_below_lower_bb" in types
    assert skipped == 0


def test_price_above_upper_bb_fires_alert():
    from app.services.intraday import evaluate_intraday_conditions

    alerts, skipped = evaluate_intraday_conditions(
        symbol="AAPL",
        current_price=156.0,   # above bb_upper=155
        snapshot=_snap(),
        existing=set(),
        today=date(2026, 4, 1),
    )

    types = {a["alert_type"] for a in alerts}
    assert "price_above_upper_bb" in types
    assert skipped == 0


def test_price_below_ema8_fires_alert():
    from app.services.intraday import evaluate_intraday_conditions

    alerts, skipped = evaluate_intraday_conditions(
        symbol="AAPL",
        current_price=149.0,   # below ema_8=150, but inside BB
        snapshot=_snap(),
        existing=set(),
        today=date(2026, 4, 1),
    )

    types = {a["alert_type"] for a in alerts}
    assert "price_below_ema8" in types


def test_price_above_ema8_fires_alert():
    from app.services.intraday import evaluate_intraday_conditions

    alerts, skipped = evaluate_intraday_conditions(
        symbol="AAPL",
        current_price=151.0,   # above ema_8=150, inside BB
        snapshot=_snap(),
        existing=set(),
        today=date(2026, 4, 1),
    )

    types = {a["alert_type"] for a in alerts}
    assert "price_above_ema8" in types


def test_no_conditions_fire_when_price_is_neutral():
    from app.services.intraday import evaluate_intraday_conditions

    # Price exactly at ema_8=150 and inside the BB (145–155)
    alerts, skipped = evaluate_intraday_conditions(
        symbol="AAPL",
        current_price=150.0,
        snapshot=_snap(),
        existing=set(),
        today=date(2026, 4, 1),
    )

    assert alerts == []
    assert skipped == 0


def test_dedup_skips_existing_alert():
    from app.services.intraday import evaluate_intraday_conditions

    existing = {("AAPL", "price_below_lower_bb")}

    alerts, skipped = evaluate_intraday_conditions(
        symbol="AAPL",
        current_price=144.0,   # would normally fire price_below_lower_bb
        snapshot=_snap(),
        existing=existing,
        today=date(2026, 4, 1),
    )

    types = {a["alert_type"] for a in alerts}
    assert "price_below_lower_bb" not in types
    assert skipped == 1


# ---------------------------------------------------------------------------
# 7. run_intraday_poll: happy path — alerts created
# ---------------------------------------------------------------------------

def test_run_intraday_poll_creates_alerts():
    from app.services.intraday import run_intraday_poll

    fake_snapshot = _snap("AAPL", bb_upper=155.0, bb_lower=145.0, ema_8=150.0)
    insert_mock = MagicMock()
    client_mock = MagicMock()
    client_mock.table.return_value.insert.return_value.execute = insert_mock
    client_mock.table.return_value.select.return_value.execute.return_value.data = []

    with patch("app.services.intraday._get_watchlist_symbols", return_value=["AAPL"]), \
         patch("app.services.intraday.fetch_intraday_quote", return_value=144.0), \
         patch("app.services.intraday.get_latest_snapshots", return_value=[fake_snapshot]), \
         patch("app.services.intraday._get_existing_intraday_alerts_today", return_value=set()), \
         patch("app.services.intraday.get_client", return_value=client_mock):
        result = run_intraday_poll()

    assert result["symbols_polled"] == 1
    assert result["alerts_created"] >= 1   # price_below_lower_bb fired


# ---------------------------------------------------------------------------
# 8. run_intraday_poll: symbol with no snapshot is skipped
# ---------------------------------------------------------------------------

def test_run_intraday_poll_skips_symbol_with_no_snapshot():
    from app.services.intraday import run_intraday_poll

    with patch("app.services.intraday._get_watchlist_symbols", return_value=["AAPL"]), \
         patch("app.services.intraday.fetch_intraday_quote", return_value=150.0), \
         patch("app.services.intraday.get_latest_snapshots", return_value=[]),  \
         patch("app.services.intraday._get_existing_intraday_alerts_today", return_value=set()), \
         patch("app.services.intraday.get_client", return_value=MagicMock()):
        result = run_intraday_poll()   # must not raise

    assert result["alerts_created"] == 0


# ---------------------------------------------------------------------------
# 9. run_intraday_poll: quote fetch failure is swallowed
# ---------------------------------------------------------------------------

def test_run_intraday_poll_continues_past_fetch_failure():
    from app.services.intraday import run_intraday_poll

    def fake_quote(symbol):
        if symbol == "BAD":
            raise ValueError("network error")
        return 156.0  # above bb_upper=155 → fires alert

    fake_snap_good = _snap("GOOD", bb_upper=155.0, bb_lower=145.0, ema_8=150.0)

    with patch("app.services.intraday._get_watchlist_symbols", return_value=["BAD", "GOOD"]), \
         patch("app.services.intraday.fetch_intraday_quote", side_effect=fake_quote), \
         patch("app.services.intraday.get_latest_snapshots", return_value=[fake_snap_good]), \
         patch("app.services.intraday._get_existing_intraday_alerts_today", return_value=set()), \
         patch("app.services.intraday.get_client", return_value=MagicMock()):
        result = run_intraday_poll()   # must not raise

    assert result["failed"] == 1
    assert result["symbols_polled"] == 2  # both attempted


# ---------------------------------------------------------------------------
# 10. run_intraday_poll: empty watchlist exits early
# ---------------------------------------------------------------------------

def test_run_intraday_poll_empty_watchlist():
    from app.services.intraday import run_intraday_poll

    fetch_mock = MagicMock()

    with patch("app.services.intraday._get_watchlist_symbols", return_value=[]), \
         patch("app.services.intraday.fetch_intraday_quote", fetch_mock):
        result = run_intraday_poll()

    fetch_mock.assert_not_called()
    assert result["symbols_polled"] == 0


# ---------------------------------------------------------------------------
# 11. run_intraday_poll: returns summary dict with expected keys
# ---------------------------------------------------------------------------

def test_run_intraday_poll_returns_summary_keys():
    from app.services.intraday import run_intraday_poll

    with patch("app.services.intraday._get_watchlist_symbols", return_value=[]), \
         patch("app.services.intraday.fetch_intraday_quote", return_value=150.0):
        result = run_intraday_poll()

    for key in ("symbols_polled", "alerts_created", "alerts_skipped", "failed"):
        assert key in result, f"Missing key: {key}"


# ---------------------------------------------------------------------------
# 12. Scheduler registers five intraday poll jobs at correct ET times
# ---------------------------------------------------------------------------

_EXPECTED_INTRADAY_JOBS = {
    "intraday_poll_0930": ("9",  "30"),
    "intraday_poll_1100": ("11", "0"),
    "intraday_poll_1230": ("12", "30"),
    "intraday_poll_1400": ("14", "0"),
    "intraday_poll_1530": ("15", "30"),
}


def test_scheduler_registers_intraday_poll_jobs():
    async def run():
        sched_svc.start_scheduler()
        assert sched_svc._scheduler is not None

        for job_id, (expected_hour, expected_minute) in _EXPECTED_INTRADAY_JOBS.items():
            job = sched_svc._scheduler.get_job(job_id)
            assert job is not None, f"Expected scheduler job '{job_id}' to be registered"
            fields = {f.name: str(f) for f in job.trigger.fields}
            assert fields["hour"]   == expected_hour,   f"{job_id}: hour mismatch"
            assert fields["minute"] == expected_minute, f"{job_id}: minute mismatch"

        sched_svc._scheduler.shutdown(wait=False)
        sched_svc._scheduler = None

    asyncio.run(run())
