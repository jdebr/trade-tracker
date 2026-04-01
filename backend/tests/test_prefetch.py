"""
Tests for the Saturday universe prefetch job.

Criteria:
 1. fetch_bulk_yfinance returns a success list and a failure list
 2. fetch_bulk_yfinance failure list contains symbols that raised exceptions
 3. fetch_bulk_with_fallback calls Twelve Data only for yfinance failures
 4. fetch_bulk_with_fallback TD failures are collected separately (not aborted)
 5. run_prefetch_job fetches OHLCV → computes indicators → updates metadata → runs screener, in order
 6. run_prefetch_job with no tickers logs an error and returns early
 7. run_prefetch_job returns a summary dict with the expected keys
 8. run_prefetch_job continues past partial fetch failures (doesn't abort)
 9. Scheduler registers a Saturday cron job named "universe_prefetch"
10. EOD scan job is registered at hour=16, minute=15
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
# 5. run_prefetch_job calls steps in the right order
# ---------------------------------------------------------------------------

def test_run_prefetch_job_calls_steps_in_order():
    from app.services.prefetch import run_prefetch_job

    call_order = []

    def fake_get_symbols():
        return ["AAPL", "MSFT"]

    def fake_fetch_bulk(symbols, lookback_days=100):
        call_order.append("fetch")
        return (["AAPL", "MSFT"], [])

    def fake_compute(symbol):
        call_order.append(f"compute:{symbol}")
        return {}

    def fake_update_metadata(symbols):
        call_order.append("metadata")

    def fake_run_screener():
        call_order.append("screener")
        from datetime import datetime, timezone
        return datetime.now(timezone.utc), []

    with patch("app.services.prefetch._get_all_ticker_symbols", fake_get_symbols), \
         patch("app.services.prefetch.fetch_bulk_with_fallback", fake_fetch_bulk), \
         patch("app.services.prefetch.compute_indicators", fake_compute), \
         patch("app.services.prefetch.update_ticker_metadata", fake_update_metadata), \
         patch("app.services.prefetch.run_screener", fake_run_screener):
        run_prefetch_job()

    assert call_order[0] == "fetch"
    assert "compute:AAPL" in call_order
    assert "compute:MSFT" in call_order
    assert call_order.index("metadata") > call_order.index("compute:AAPL")
    assert call_order[-1] == "screener"


# ---------------------------------------------------------------------------
# 6. run_prefetch_job with empty tickers table exits early
# ---------------------------------------------------------------------------

def test_run_prefetch_job_empty_tickers_exits_early():
    from app.services.prefetch import run_prefetch_job

    fetch_mock = MagicMock()

    with patch("app.services.prefetch._get_all_ticker_symbols", return_value=[]), \
         patch("app.services.prefetch.fetch_bulk_with_fallback", fetch_mock):
        result = run_prefetch_job()

    fetch_mock.assert_not_called()
    assert result["tickers_attempted"] == 0


# ---------------------------------------------------------------------------
# 7. run_prefetch_job returns summary dict with expected keys
# ---------------------------------------------------------------------------

def test_run_prefetch_job_returns_summary():
    from app.services.prefetch import run_prefetch_job

    with patch("app.services.prefetch._get_all_ticker_symbols", return_value=["AAPL"]), \
         patch("app.services.prefetch.fetch_bulk_with_fallback", return_value=(["AAPL"], [])), \
         patch("app.services.prefetch.compute_indicators", return_value={}), \
         patch("app.services.prefetch.update_ticker_metadata"), \
         patch("app.services.prefetch.run_screener", return_value=(MagicMock(), [])):
        result = run_prefetch_job()

    for key in ("tickers_attempted", "fetched", "failed", "screener_candidates"):
        assert key in result, f"Missing key: {key}"


# ---------------------------------------------------------------------------
# 8. run_prefetch_job continues past partial failures
# ---------------------------------------------------------------------------

def test_run_prefetch_job_continues_past_partial_failures():
    from app.services.prefetch import run_prefetch_job

    compute_calls = []

    def fake_compute(symbol):
        compute_calls.append(symbol)
        if symbol == "BAD":
            raise Exception("compute failed")
        return {}

    with patch("app.services.prefetch._get_all_ticker_symbols", return_value=["AAPL", "BAD", "MSFT"]), \
         patch("app.services.prefetch.fetch_bulk_with_fallback", return_value=(["AAPL", "BAD", "MSFT"], [])), \
         patch("app.services.prefetch.compute_indicators", side_effect=fake_compute), \
         patch("app.services.prefetch.update_ticker_metadata"), \
         patch("app.services.prefetch.run_screener", return_value=(MagicMock(), [])):
        result = run_prefetch_job()

    # All three symbols were attempted despite BAD failing
    assert set(compute_calls) == {"AAPL", "BAD", "MSFT"}
    assert result["fetched"] == 3


# ---------------------------------------------------------------------------
# 9. Scheduler registers a Saturday prefetch job
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
# 10. EOD scan job registered at 16:15
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
