"""
Tests for Milestone 7 scheduler — pause/resume/cooldown/holiday logic.

Criteria:
1.  get_status() returns the required keys
2.  pause() sets _pause_until in the future and _is_paused() returns True
3.  resume() clears the pause
4.  An expired pause auto-clears on the next _is_paused() check
5.  Cooldown is active immediately after _last_run_at is set
6.  Cooldown expires after the configured window
7.  No cooldown when server has never run a scan
8.  _is_market_open_today returns True on a known trading day
9.  _is_market_open_today returns False on a NYSE holiday
10. _is_market_open_today returns False on a Saturday
"""

from datetime import date, datetime, timedelta, timezone
import app.services.scheduler as svc


def setup_function():
    """Reset all in-memory scheduler state before each test."""
    svc._pause_until     = None
    svc._last_run_at     = None
    svc._last_run_result = None
    svc._scheduler       = None


# ---------------------------------------------------------------------------
# 1. Status structure
# ---------------------------------------------------------------------------

def test_status_has_required_keys():
    status = svc.get_status()
    for key in (
        "enabled",
        "paused",
        "pause_until",
        "next_run_time",
        "last_run_at",
        "last_run_result",
        "cooldown_minutes",
        "seconds_until_cooldown_expires",
        "schedule",
    ):
        assert key in status, f"Missing key: {key}"


def test_status_defaults_when_never_run():
    status = svc.get_status()
    assert status["paused"]           is False
    assert status["pause_until"]      is None
    assert status["last_run_at"]      is None
    assert status["last_run_result"]  is None
    assert status["seconds_until_cooldown_expires"] is None


# ---------------------------------------------------------------------------
# 2. Pause
# ---------------------------------------------------------------------------

def test_pause_sets_future_pause_until():
    pause_until = svc.pause(2.0)
    assert pause_until > datetime.now(timezone.utc)


def test_is_paused_true_after_pause():
    svc.pause(24.0)
    assert svc._is_paused() is True


def test_status_reflects_pause():
    svc.pause(12.0)
    status = svc.get_status()
    assert status["paused"]      is True
    assert status["pause_until"] is not None


# ---------------------------------------------------------------------------
# 3. Resume
# ---------------------------------------------------------------------------

def test_resume_clears_pause():
    svc.pause(24.0)
    svc.resume()
    assert svc._is_paused() is False


def test_resume_when_not_paused_is_safe():
    svc.resume()  # should not raise
    assert svc._is_paused() is False


# ---------------------------------------------------------------------------
# 4. Expired pause auto-clears
# ---------------------------------------------------------------------------

def test_expired_pause_auto_clears():
    svc._pause_until = datetime.now(timezone.utc) - timedelta(seconds=1)
    assert svc._is_paused() is False
    assert svc._pause_until is None


# ---------------------------------------------------------------------------
# 5–6. Cooldown
# ---------------------------------------------------------------------------

def test_cooldown_active_immediately_after_run():
    svc._last_run_at = datetime.now(timezone.utc)
    remaining = svc._seconds_until_cooldown_expires()
    assert remaining is not None
    assert remaining > 0


def test_cooldown_expires_after_window():
    # Simulate a run that happened cooldown_minutes + 1 minute ago
    svc._last_run_at = datetime.now(timezone.utc) - timedelta(
        minutes=svc.SCAN_COOLDOWN_MINUTES + 1
    )
    assert svc._seconds_until_cooldown_expires() is None


def test_cooldown_remaining_decreases_over_time():
    svc._last_run_at = datetime.now(timezone.utc) - timedelta(minutes=30)
    remaining = svc._seconds_until_cooldown_expires()
    expected  = (svc.SCAN_COOLDOWN_MINUTES - 30) * 60
    # Allow ±5 s for test execution time
    assert abs(remaining - expected) < 5


# ---------------------------------------------------------------------------
# 7. No cooldown when never run
# ---------------------------------------------------------------------------

def test_no_cooldown_when_never_run():
    assert svc._seconds_until_cooldown_expires() is None


# ---------------------------------------------------------------------------
# 8–10. Market calendar
# ---------------------------------------------------------------------------

def test_market_open_on_known_trading_day():
    # Monday Jan 6 2025 — regular trading day
    assert svc._is_market_open_today(date(2025, 1, 6)) is True


def test_market_closed_on_nyse_holiday():
    # July 4 2025 — Independence Day (NYSE closed)
    assert svc._is_market_open_today(date(2025, 7, 4)) is False


def test_market_closed_on_saturday():
    assert svc._is_market_open_today(date(2025, 1, 4)) is False


def test_market_closed_on_sunday():
    assert svc._is_market_open_today(date(2025, 1, 5)) is False


def test_market_closed_on_christmas():
    # Dec 25 2025 — Christmas Day
    assert svc._is_market_open_today(date(2025, 12, 25)) is False
