"""
Tests for the pre-market earnings check (app/services/earnings.py).

Criteria:
 1.  fetch_earnings_dates returns a list of date objects for a symbol
 2.  fetch_earnings_dates returns [] when the symbol has no calendar data
 3.  fetch_earnings_dates returns [] when Ticker.calendar raises (network/bad symbol)
 4.  is_earnings_within_days: returns True when an earnings date is within the window
 5.  is_earnings_within_days: returns False when all dates are beyond the window
 6.  is_earnings_within_days: returns False for an empty date list
 7.  run_earnings_check: fires earnings_approaching for qualifying symbols
 8.  run_earnings_check: does not fire for symbols with earnings outside the window
 9.  run_earnings_check: dedup — skips (symbol, earnings_approaching) already in DB today
10.  run_earnings_check: continues past individual fetch failures (job does not abort)
11.  run_earnings_check: empty watchlist exits early, no alerts inserted
12.  run_earnings_check: returns summary dict with expected keys
13.  Scheduler registers an earnings_check job at 8:00 AM ET Mon–Fri
"""

from datetime import date, timedelta
from unittest.mock import MagicMock, patch
import asyncio
import pytest

import app.services.scheduler as sched_svc


def setup_function():
    sched_svc._scheduler       = None
    sched_svc._pause_until     = None
    sched_svc._last_run_at     = None
    sched_svc._last_run_result = None


# ---------------------------------------------------------------------------
# 1. fetch_earnings_dates returns dates
# ---------------------------------------------------------------------------

def test_fetch_earnings_dates_returns_dates():
    from app.services.earnings import fetch_earnings_dates

    today = date(2026, 4, 1)
    fake_calendar = {"Earnings Date": [today + timedelta(days=3)]}

    with patch("app.services.earnings.yf.Ticker") as mock_ticker:
        mock_ticker.return_value.calendar = fake_calendar
        result = fetch_earnings_dates("AAPL")

    assert result == [today + timedelta(days=3)]


# ---------------------------------------------------------------------------
# 2. fetch_earnings_dates returns [] with no calendar
# ---------------------------------------------------------------------------

def test_fetch_earnings_dates_empty_calendar():
    from app.services.earnings import fetch_earnings_dates

    with patch("app.services.earnings.yf.Ticker") as mock_ticker:
        mock_ticker.return_value.calendar = {}
        result = fetch_earnings_dates("AAPL")

    assert result == []


# ---------------------------------------------------------------------------
# 3. fetch_earnings_dates returns [] on exception
# ---------------------------------------------------------------------------

def test_fetch_earnings_dates_handles_exception():
    from app.services.earnings import fetch_earnings_dates

    with patch("app.services.earnings.yf.Ticker") as mock_ticker:
        mock_ticker.return_value.calendar = property(lambda self: (_ for _ in ()).throw(Exception("network error")))
        # Simulate exception raised when accessing .calendar
        mock_ticker.return_value.__class__.calendar = property(
            lambda self: (_ for _ in ()).throw(Exception("network error"))
        )
        result = fetch_earnings_dates("BAD")

    assert result == []


# ---------------------------------------------------------------------------
# 4 & 5. is_earnings_within_days
# ---------------------------------------------------------------------------

def test_is_earnings_within_days_true_when_in_window():
    from app.services.earnings import is_earnings_within_days

    today = date(2026, 4, 1)
    dates = [today + timedelta(days=4)]
    assert is_earnings_within_days(dates, today=today, window_days=5) is True


def test_is_earnings_within_days_false_when_outside_window():
    from app.services.earnings import is_earnings_within_days

    today = date(2026, 4, 1)
    dates = [today + timedelta(days=10)]
    assert is_earnings_within_days(dates, today=today, window_days=5) is False


# ---------------------------------------------------------------------------
# 6. is_earnings_within_days: empty list
# ---------------------------------------------------------------------------

def test_is_earnings_within_days_false_for_empty():
    from app.services.earnings import is_earnings_within_days

    assert is_earnings_within_days([], today=date(2026, 4, 1), window_days=5) is False


# ---------------------------------------------------------------------------
# 7. run_earnings_check fires alert for qualifying symbol
# ---------------------------------------------------------------------------

def test_run_earnings_check_fires_alert():
    from app.services.earnings import run_earnings_check

    today = date(2026, 4, 1)
    earnings_soon = [today + timedelta(days=2)]

    insert_mock = MagicMock()
    client_mock = MagicMock()
    client_mock.table.return_value.insert.return_value.execute = insert_mock
    client_mock.table.return_value.select.return_value.in_.return_value.eq.return_value.execute.return_value.data = []

    with patch("app.services.earnings._get_watchlist_symbols", return_value=["AAPL"]), \
         patch("app.services.earnings.fetch_earnings_dates", return_value=earnings_soon), \
         patch("app.services.earnings._get_existing_earnings_alerts_today", return_value=set()), \
         patch("app.services.earnings.get_client", return_value=client_mock), \
         patch("app.services.earnings.date") as mock_date:
        mock_date.today.return_value = today
        mock_date.side_effect = lambda *a, **kw: date(*a, **kw)
        result = run_earnings_check()

    assert result["alerts_created"] == 1
    assert result["symbols_checked"] == 1


# ---------------------------------------------------------------------------
# 8. run_earnings_check does not fire when earnings are far out
# ---------------------------------------------------------------------------

def test_run_earnings_check_no_alert_when_earnings_far():
    from app.services.earnings import run_earnings_check

    today = date(2026, 4, 1)
    earnings_far = [today + timedelta(days=30)]

    with patch("app.services.earnings._get_watchlist_symbols", return_value=["AAPL"]), \
         patch("app.services.earnings.fetch_earnings_dates", return_value=earnings_far), \
         patch("app.services.earnings._get_existing_earnings_alerts_today", return_value=set()), \
         patch("app.services.earnings.get_client", return_value=MagicMock()), \
         patch("app.services.earnings.date") as mock_date:
        mock_date.today.return_value = today
        mock_date.side_effect = lambda *a, **kw: date(*a, **kw)
        result = run_earnings_check()

    assert result["alerts_created"] == 0


# ---------------------------------------------------------------------------
# 9. run_earnings_check dedup
# ---------------------------------------------------------------------------

def test_run_earnings_check_dedup_skips_existing():
    from app.services.earnings import run_earnings_check

    today = date(2026, 4, 1)
    earnings_soon = [today + timedelta(days=2)]

    with patch("app.services.earnings._get_watchlist_symbols", return_value=["AAPL"]), \
         patch("app.services.earnings.fetch_earnings_dates", return_value=earnings_soon), \
         patch("app.services.earnings._get_existing_earnings_alerts_today",
               return_value={("AAPL", "earnings_approaching")}), \
         patch("app.services.earnings.get_client", return_value=MagicMock()), \
         patch("app.services.earnings.date") as mock_date:
        mock_date.today.return_value = today
        mock_date.side_effect = lambda *a, **kw: date(*a, **kw)
        result = run_earnings_check()

    assert result["alerts_created"] == 0
    assert result["alerts_skipped"] == 1


# ---------------------------------------------------------------------------
# 10. run_earnings_check continues past individual fetch failure
# ---------------------------------------------------------------------------

def test_run_earnings_check_continues_past_failure():
    from app.services.earnings import run_earnings_check

    today = date(2026, 4, 1)
    earnings_soon = [today + timedelta(days=2)]

    def fake_fetch(symbol):
        if symbol == "BAD":
            raise ValueError("no data")
        return earnings_soon

    with patch("app.services.earnings._get_watchlist_symbols", return_value=["BAD", "GOOD"]), \
         patch("app.services.earnings.fetch_earnings_dates", side_effect=fake_fetch), \
         patch("app.services.earnings._get_existing_earnings_alerts_today", return_value=set()), \
         patch("app.services.earnings.get_client", return_value=MagicMock()), \
         patch("app.services.earnings.date") as mock_date:
        mock_date.today.return_value = today
        mock_date.side_effect = lambda *a, **kw: date(*a, **kw)
        result = run_earnings_check()   # must not raise

    assert result["failed"] == 1
    assert result["alerts_created"] == 1   # GOOD fired


# ---------------------------------------------------------------------------
# 11. run_earnings_check: empty watchlist exits early
# ---------------------------------------------------------------------------

def test_run_earnings_check_empty_watchlist():
    from app.services.earnings import run_earnings_check

    fetch_mock = MagicMock()

    with patch("app.services.earnings._get_watchlist_symbols", return_value=[]), \
         patch("app.services.earnings.fetch_earnings_dates", fetch_mock):
        result = run_earnings_check()

    fetch_mock.assert_not_called()
    assert result["symbols_checked"] == 0


# ---------------------------------------------------------------------------
# 12. run_earnings_check: returns summary dict with expected keys
# ---------------------------------------------------------------------------

def test_run_earnings_check_returns_summary_keys():
    from app.services.earnings import run_earnings_check

    with patch("app.services.earnings._get_watchlist_symbols", return_value=[]):
        result = run_earnings_check()

    for key in ("symbols_checked", "alerts_created", "alerts_skipped", "failed"):
        assert key in result, f"Missing key: {key}"


# ---------------------------------------------------------------------------
# 13. Scheduler registers earnings_check at 8:00 AM ET Mon–Fri
# ---------------------------------------------------------------------------

def test_scheduler_registers_earnings_check_job():
    async def run():
        sched_svc.start_scheduler()
        job = sched_svc._scheduler.get_job("earnings_check")
        assert job is not None, "Expected 'earnings_check' job to be registered"
        fields = {f.name: str(f) for f in job.trigger.fields}
        assert fields["hour"]   == "8", f"Expected hour=8, got {fields['hour']}"
        assert fields["minute"] == "0", f"Expected minute=0, got {fields['minute']}"
        sched_svc._scheduler.shutdown(wait=False)
        sched_svc._scheduler = None

    asyncio.run(run())
