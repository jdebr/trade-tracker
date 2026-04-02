"""
Tests for the data refresh pipeline (app/services/prefetch.py) and scheduler
registration (app/services/scheduler.py).

Criteria:
 1. fetch_bulk_yfinance returns a success list and a failure list
 2. fetch_bulk_yfinance failure list contains symbols that raised exceptions
 3. fetch_bulk_with_fallback calls Twelve Data only for yfinance failures
 4. fetch_bulk_with_fallback TD failures are collected separately (not aborted)
 5. run_data_refresh fetches OHLCV → computes indicators → updates metadata, in order
 6. run_data_refresh with no tickers logs an error and returns early
 7. run_data_refresh returns a summary dict with the expected keys
 8. run_data_refresh continues past partial fetch failures (doesn't abort)
 9. run_data_refresh skips fresh symbols (bulk_check_freshness)
10. run_data_refresh with force=True fetches all symbols regardless of freshness
11. Scheduler registers a Saturday cron job named "universe_prefetch"
12. EOD scan job is registered at hour=16, minute=15
13. prefetch_job() calls run_data_refresh then run_screener in order
"""

from unittest.mock import MagicMock, patch, call
import pytest
import app.services.scheduler as sched_svc


def setup_function():
    """Reset scheduler state before each test."""
    sched_svc._scheduler       = None
    sched_svc._pause_until     = None
    sched_svc._last_run_at     = None
    sched_svc._last_run_result = None


# ---------------------------------------------------------------------------
# 1 & 2. fetch_bulk_yfinance
# ---------------------------------------------------------------------------

def test_fetch_bulk_yfinance_returns_successes_and_failures():
    from app.services.prefetch import fetch_bulk_yfinance

    def fake_fetch(symbol, lookback_days=100):
        if symbol == "FAIL":
            raise ValueError("no data")
        return [{"symbol": symbol, "date": "2026-03-28", "close": 100.0}]

    with patch("app.services.prefetch.fetch_from_yfinance", side_effect=fake_fetch), \
         patch("app.services.ohlcv_cache.upsert_bars"):
        successes, failures = fetch_bulk_yfinance(["AAPL", "FAIL", "MSFT"])

    assert "AAPL" in successes
    assert "MSFT" in successes
    assert "FAIL" in failures
    assert "FAIL" not in successes


def test_fetch_bulk_yfinance_all_succeed():
    from app.services.prefetch import fetch_bulk_yfinance

    with patch("app.services.prefetch.fetch_from_yfinance", return_value=[{"close": 1.0}]), \
         patch("app.services.ohlcv_cache.upsert_bars"):
        successes, failures = fetch_bulk_yfinance(["AAPL", "MSFT"])

    assert set(successes) == {"AAPL", "MSFT"}
    assert failures == []


# ---------------------------------------------------------------------------
# 3. fetch_bulk_with_fallback only calls TD for yfinance failures
# ---------------------------------------------------------------------------

def test_fetch_bulk_with_fallback_td_called_only_for_failures():
    from app.services.prefetch import fetch_bulk_with_fallback

    def fake_yf(symbol, lookback_days=100):
        if symbol == "BAD":
            raise ValueError("yfinance failed")
        return [{"close": 1.0}]

    td_mock = MagicMock(return_value=[{"close": 1.0}])

    with patch("app.services.prefetch.fetch_from_yfinance", side_effect=fake_yf), \
         patch("app.services.prefetch.fetch_from_twelve_data", td_mock), \
         patch("app.services.ohlcv_cache.upsert_bars"):
        successes, failures = fetch_bulk_with_fallback(["AAPL", "BAD", "MSFT"])

    # TD called exactly once — for the one failure
    td_mock.assert_called_once_with("BAD", lookback_days=100)
    assert "AAPL" in successes
    assert "MSFT" in successes
    assert "BAD" in successes   # recovered by TD
    assert failures == []


# ---------------------------------------------------------------------------
# 4. TD fallback failures are collected, not aborted
# ---------------------------------------------------------------------------

def test_fetch_bulk_with_fallback_td_failure_collected():
    from app.services.prefetch import fetch_bulk_with_fallback

    with patch("app.services.prefetch.fetch_from_yfinance", side_effect=ValueError("yf fail")), \
         patch("app.services.prefetch.fetch_from_twelve_data", side_effect=Exception("td fail")):
        successes, failures = fetch_bulk_with_fallback(["BAD"])

    assert successes == []
    assert "BAD" in failures


# ---------------------------------------------------------------------------
# 5. run_data_refresh calls steps in the right order
# ---------------------------------------------------------------------------

def test_run_data_refresh_calls_steps_in_order():
    from app.services.prefetch import run_data_refresh

    call_order = []

    with patch("app.services.prefetch._get_all_ticker_symbols", return_value=["AAPL", "MSFT"]), \
         patch("app.services.prefetch.bulk_check_freshness", return_value={"AAPL": False, "MSFT": False}), \
         patch("app.services.prefetch.fetch_bulk_with_fallback",
               side_effect=lambda s, **kw: call_order.append("fetch") or (list(s), [])), \
         patch("app.services.prefetch.compute_indicators",
               side_effect=lambda sym: call_order.append(f"compute:{sym}") or {}), \
         patch("app.services.prefetch.update_ticker_metadata",
               side_effect=lambda s: call_order.append("metadata")):
        run_data_refresh()

    assert call_order[0] == "fetch"
    assert "compute:AAPL" in call_order
    assert "compute:MSFT" in call_order
    assert call_order.index("metadata") > call_order.index("compute:AAPL")
    # Screener is NOT called inside run_data_refresh
    assert "screener" not in call_order


# ---------------------------------------------------------------------------
# 6. run_data_refresh with empty tickers table exits early
# ---------------------------------------------------------------------------

def test_run_data_refresh_empty_tickers_exits_early():
    from app.services.prefetch import run_data_refresh

    fetch_mock = MagicMock()

    with patch("app.services.prefetch._get_all_ticker_symbols", return_value=[]), \
         patch("app.services.prefetch.fetch_bulk_with_fallback", fetch_mock):
        result = run_data_refresh()

    fetch_mock.assert_not_called()
    assert result["attempted"] == 0


# ---------------------------------------------------------------------------
# 7. run_data_refresh returns summary dict with expected keys
# ---------------------------------------------------------------------------

def test_run_data_refresh_returns_summary():
    from app.services.prefetch import run_data_refresh

    with patch("app.services.prefetch._get_all_ticker_symbols", return_value=["AAPL"]), \
         patch("app.services.prefetch.bulk_check_freshness", return_value={"AAPL": False}), \
         patch("app.services.prefetch.fetch_bulk_with_fallback", return_value=(["AAPL"], [])), \
         patch("app.services.prefetch.compute_indicators", return_value={}), \
         patch("app.services.prefetch.update_ticker_metadata"):
        result = run_data_refresh()

    for key in ("attempted", "fetched", "skipped_fresh", "failed", "elapsed_seconds"):
        assert key in result, f"Missing key: {key}"


# ---------------------------------------------------------------------------
# 8. run_data_refresh continues past partial failures
# ---------------------------------------------------------------------------

def test_run_data_refresh_continues_past_partial_failures():
    from app.services.prefetch import run_data_refresh

    compute_calls = []

    def fake_compute(symbol):
        compute_calls.append(symbol)
        if symbol == "BAD":
            raise Exception("compute failed")
        return {}

    with patch("app.services.prefetch._get_all_ticker_symbols", return_value=["AAPL", "BAD", "MSFT"]), \
         patch("app.services.prefetch.bulk_check_freshness",
               return_value={"AAPL": False, "BAD": False, "MSFT": False}), \
         patch("app.services.prefetch.fetch_bulk_with_fallback",
               return_value=(["AAPL", "BAD", "MSFT"], [])), \
         patch("app.services.prefetch.compute_indicators", side_effect=fake_compute), \
         patch("app.services.prefetch.update_ticker_metadata"):
        result = run_data_refresh()

    assert set(compute_calls) == {"AAPL", "BAD", "MSFT"}
    assert result["fetched"] == 3


# ---------------------------------------------------------------------------
# 9. run_data_refresh skips fresh symbols
# ---------------------------------------------------------------------------

def test_run_data_refresh_skips_fresh_symbols():
    from app.services.prefetch import run_data_refresh

    freshness = {"AAPL": True, "MSFT": False, "NVDA": True}  # MSFT is stale
    fetch_mock = MagicMock(return_value=(["MSFT"], []))

    with patch("app.services.prefetch._get_all_ticker_symbols", return_value=["AAPL", "MSFT", "NVDA"]), \
         patch("app.services.prefetch.bulk_check_freshness", return_value=freshness), \
         patch("app.services.prefetch.fetch_bulk_with_fallback", fetch_mock), \
         patch("app.services.prefetch.compute_indicators"), \
         patch("app.services.prefetch.update_ticker_metadata"):
        result = run_data_refresh()

    # Only the stale symbol was passed to fetch
    fetched_symbols = fetch_mock.call_args[0][0]
    assert fetched_symbols == ["MSFT"]
    assert result["skipped_fresh"] == 2
    assert result["attempted"] == 3


# ---------------------------------------------------------------------------
# 10. run_data_refresh force=True bypasses freshness check
# ---------------------------------------------------------------------------

def test_run_data_refresh_force_bypasses_freshness():
    from app.services.prefetch import run_data_refresh

    freshness = {"AAPL": True, "MSFT": True}  # Both fresh
    fetch_mock = MagicMock(return_value=(["AAPL", "MSFT"], []))

    with patch("app.services.prefetch._get_all_ticker_symbols", return_value=["AAPL", "MSFT"]), \
         patch("app.services.prefetch.bulk_check_freshness", return_value=freshness), \
         patch("app.services.prefetch.fetch_bulk_with_fallback", fetch_mock), \
         patch("app.services.prefetch.compute_indicators"), \
         patch("app.services.prefetch.update_ticker_metadata"):
        result = run_data_refresh(force=True)

    # All symbols fetched despite being fresh
    fetched_symbols = fetch_mock.call_args[0][0]
    assert set(fetched_symbols) == {"AAPL", "MSFT"}
    assert result["skipped_fresh"] == 0


# ---------------------------------------------------------------------------
# 11. Scheduler registers a Saturday prefetch job
# ---------------------------------------------------------------------------

import asyncio

def test_scheduler_registers_saturday_prefetch_job():
    async def run():
        sched_svc.start_scheduler()
        assert sched_svc._scheduler is not None
        job = sched_svc._scheduler.get_job("universe_prefetch")
        assert job is not None, "Expected 'universe_prefetch' job to be registered"
        sched_svc._scheduler.shutdown(wait=False)
        sched_svc._scheduler = None

    asyncio.run(run())


# ---------------------------------------------------------------------------
# 12. EOD scan job registered at 16:15
# ---------------------------------------------------------------------------

def test_eod_scan_job_registered_at_16_15():
    async def run():
        sched_svc.start_scheduler()
        job = sched_svc._scheduler.get_job("watchlist_scan")
        assert job is not None
        trigger = job.trigger
        fields = {f.name: str(f) for f in trigger.fields}
        assert fields["hour"] == "16"
        assert fields["minute"] == "15"
        sched_svc._scheduler.shutdown(wait=False)
        sched_svc._scheduler = None

    asyncio.run(run())


# ---------------------------------------------------------------------------
# 13. prefetch_job() calls run_data_refresh then run_screener in order
# ---------------------------------------------------------------------------

def test_prefetch_job_calls_refresh_then_screener():
    """The Saturday prefetch_job should call run_data_refresh first, then run_screener."""
    call_order = []

    from datetime import datetime, timezone

    def fake_refresh(**kwargs):
        call_order.append("refresh")
        return {"attempted": 2, "fetched": 2, "skipped_fresh": 0, "failed": 0, "elapsed_seconds": 1}

    def fake_screener():
        call_order.append("screener")
        return datetime.now(timezone.utc), []

    async def run():
        with patch("app.services.scheduler.run_data_refresh", side_effect=fake_refresh), \
             patch("app.services.scheduler.run_screener", side_effect=fake_screener):
            await sched_svc.prefetch_job()

    asyncio.run(run())

    assert "refresh" in call_order
    assert "screener" in call_order
    assert call_order.index("refresh") < call_order.index("screener")
