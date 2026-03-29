"""
APScheduler integration for the daily watchlist scan.

The scheduler fires at SCHEDULER_HOUR:SCHEDULER_MINUTE ET, Monday–Friday.
It skips runs on NYSE market holidays.

Controls (all in-memory; reset on server restart):
  pause(hours)  — suspend the job for N hours
  resume()      — clear the pause immediately
  trigger_now() — manual on-demand run, subject to SCAN_COOLDOWN_MINUTES

.env knobs:
  SCHEDULER_ENABLED      true/false  (default true)
  SCHEDULER_HOUR         0–23 ET     (default 16)
  SCHEDULER_MINUTE       0–59        (default 0)
  SCAN_COOLDOWN_MINUTES  integer     (default 60)

Public API:
  start_scheduler()
  stop_scheduler()
  pause(hours) -> datetime
  resume()
  async trigger_now() -> tuple[bool, str, ScanResult | None]
  get_status() -> dict
  _is_market_open_today(check_date?)  (also exported for tests)
"""

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone

import pandas_market_calendars as mcal
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.config import (
    SCAN_COOLDOWN_MINUTES,
    SCHEDULER_ENABLED,
    SCHEDULER_HOUR,
    SCHEDULER_MINUTE,
)
from app.services.scanner import ScanResult, run_watchlist_scan

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------

_scheduler:       AsyncIOScheduler | None = None
_pause_until:     datetime | None         = None
_last_run_at:     datetime | None         = None
_last_run_result: dict | None             = None

_nyse = mcal.get_calendar("NYSE")


# ---------------------------------------------------------------------------
# Market calendar
# ---------------------------------------------------------------------------

def _is_market_open_today(check_date: date | None = None) -> bool:
    """Return True if the given date (or today) is a NYSE trading day."""
    d = check_date or datetime.now(timezone.utc).date()
    schedule = _nyse.schedule(
        start_date=d.isoformat(),
        end_date=d.isoformat(),
    )
    return not schedule.empty


# ---------------------------------------------------------------------------
# Cooldown
# ---------------------------------------------------------------------------

def _seconds_until_cooldown_expires() -> int | None:
    """Return remaining cooldown seconds, or None if no cooldown is active."""
    if _last_run_at is None:
        return None
    elapsed   = (datetime.now(timezone.utc) - _last_run_at).total_seconds()
    remaining = SCAN_COOLDOWN_MINUTES * 60 - elapsed
    return int(remaining) if remaining > 0 else None


def _is_in_cooldown() -> bool:
    return _seconds_until_cooldown_expires() is not None


# ---------------------------------------------------------------------------
# Pause / Resume
# ---------------------------------------------------------------------------

def pause(hours: float) -> datetime:
    """Pause the scheduler for `hours` hours. Returns the pause_until time."""
    global _pause_until
    _pause_until = datetime.now(timezone.utc) + timedelta(hours=hours)
    logger.info("Scheduler paused until %s", _pause_until.isoformat())
    return _pause_until


def resume() -> None:
    """Clear any active pause immediately."""
    global _pause_until
    _pause_until = None
    logger.info("Scheduler resumed")


def _is_paused() -> bool:
    global _pause_until
    if _pause_until is None:
        return False
    if datetime.now(timezone.utc) >= _pause_until:
        _pause_until = None   # auto-clear expired pause
        return False
    return True


# ---------------------------------------------------------------------------
# Core scan execution
# ---------------------------------------------------------------------------

async def _run_scan_job() -> ScanResult | None:
    """
    Execute one scan cycle. Sets _last_run_at before running so the cooldown
    activates immediately, protecting against API overuse even on partial runs.
    Returns ScanResult or None on unexpected failure.
    """
    global _last_run_at, _last_run_result
    _last_run_at = datetime.now(timezone.utc)

    try:
        # run_watchlist_scan is synchronous and may take 30–60 s for a full
        # watchlist; run it in a thread so we don't block the event loop.
        result = await asyncio.to_thread(run_watchlist_scan)
        _last_run_result = result.to_dict()
        return result
    except Exception as exc:
        logger.error("Watchlist scan failed: %s", exc, exc_info=True)
        _last_run_result = {"error": str(exc), "run_at": _last_run_at.isoformat()}
        return None


# ---------------------------------------------------------------------------
# Scheduled job entry point
# ---------------------------------------------------------------------------

async def scheduled_job() -> None:
    """APScheduler cron entry point — checks pause and market holiday."""
    if _is_paused():
        logger.info(
            "Scheduled scan skipped — paused until %s",
            _pause_until.isoformat() if _pause_until else "unknown",
        )
        return

    if not _is_market_open_today():
        logger.info("Scheduled scan skipped — market closed today")
        return

    logger.info("Scheduled scan starting")
    await _run_scan_job()


# ---------------------------------------------------------------------------
# Manual trigger
# ---------------------------------------------------------------------------

async def trigger_now() -> tuple[bool, str, ScanResult | None]:
    """
    Manually trigger a scan outside the cron schedule.
    Enforces cooldown to protect against API overuse.

    Returns:
        (success, message, result_or_None)
    """
    if _is_paused():
        msg = (
            f"Scheduler is paused until "
            f"{_pause_until.isoformat() if _pause_until else 'unknown'}"
        )
        return False, msg, None

    cooldown_remaining = _seconds_until_cooldown_expires()
    if cooldown_remaining is not None:
        return False, f"Cooldown active — {cooldown_remaining}s remaining", None

    logger.info("Manual scan trigger")
    result = await _run_scan_job()
    return True, "Scan completed", result


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------

def get_status() -> dict:
    _is_paused()  # side-effect: auto-clears expired pause

    next_run = None
    if _scheduler:
        job = _scheduler.get_job("watchlist_scan")
        if job and job.next_run_time:
            next_run = job.next_run_time.isoformat()

    return {
        "enabled":                        SCHEDULER_ENABLED,
        "paused":                         _is_paused(),
        "pause_until":                    _pause_until.isoformat() if _pause_until else None,
        "next_run_time":                  next_run,
        "last_run_at":                    _last_run_at.isoformat() if _last_run_at else None,
        "last_run_result":                _last_run_result,
        "cooldown_minutes":               SCAN_COOLDOWN_MINUTES,
        "seconds_until_cooldown_expires": _seconds_until_cooldown_expires(),
        "schedule":                       f"{SCHEDULER_HOUR:02d}:{SCHEDULER_MINUTE:02d} ET Mon–Fri",
    }


# ---------------------------------------------------------------------------
# Lifecycle (called from FastAPI lifespan)
# ---------------------------------------------------------------------------

def start_scheduler() -> None:
    global _scheduler

    if not SCHEDULER_ENABLED:
        logger.info("Scheduler disabled via SCHEDULER_ENABLED=false")
        return

    _scheduler = AsyncIOScheduler(timezone="America/New_York")
    _scheduler.add_job(
        scheduled_job,
        trigger=CronTrigger(
            day_of_week="mon-fri",
            hour=SCHEDULER_HOUR,
            minute=SCHEDULER_MINUTE,
            timezone="America/New_York",
        ),
        id="watchlist_scan",
        name="Daily watchlist scan",
        max_instances=1,
        coalesce=True,
        misfire_grace_time=3600,
    )
    _scheduler.start()
    logger.info(
        "Scheduler started — daily scan at %02d:%02d ET (Mon–Fri)",
        SCHEDULER_HOUR,
        SCHEDULER_MINUTE,
    )


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
