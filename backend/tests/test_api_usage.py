"""
Tests for Twelve Data API usage tracking.

Criteria:
 1.  fetch_td_api_usage returns current_usage and plan_limit on success
 2.  fetch_td_api_usage returns None when TWELVE_DATA_API_KEY is not configured
 3.  fetch_td_api_usage returns None on HTTP error
 4.  fetch_td_api_usage returns None when TD returns a non-ok status payload
 5.  fetch_td_api_usage returns None on network exception
 6.  get_status includes a "td_api_usage" key
 7.  get_status td_api_usage reflects live fetch result when available
 8.  get_status td_api_usage is None when key is not configured
"""

from unittest.mock import patch, MagicMock
import pytest
import app.services.market_data as _md


@pytest.fixture(autouse=True)
def reset_api_usage_cache():
    """Reset the in-memory API usage cache before each test."""
    _md._api_usage_cache = None
    _md._api_usage_cache_time = 0.0
    yield


# ---------------------------------------------------------------------------
# 1. fetch_td_api_usage happy path
# ---------------------------------------------------------------------------

def test_fetch_td_api_usage_returns_usage_on_success():
    from app.services.market_data import fetch_td_api_usage

    fake_payload = {
        "timestamp": "2026-04-01 08:00:00",
        "current_usage": 42,
        "plan_limit": 800,
        "status": "ok",
    }
    mock_resp = MagicMock()
    mock_resp.raise_for_status.return_value = None
    mock_resp.json.return_value = fake_payload

    with patch("app.services.market_data.TWELVE_DATA_API_KEY", "fake-key"), \
         patch("app.services.market_data.httpx.get", return_value=mock_resp):
        result = fetch_td_api_usage()

    assert result is not None
    assert result["current_usage"] == 42
    assert result["plan_limit"] == 800


# ---------------------------------------------------------------------------
# 2. fetch_td_api_usage returns None when no API key
# ---------------------------------------------------------------------------

def test_fetch_td_api_usage_returns_none_when_no_key():
    from app.services.market_data import fetch_td_api_usage

    with patch("app.services.market_data.TWELVE_DATA_API_KEY", ""):
        result = fetch_td_api_usage()

    assert result is None


# ---------------------------------------------------------------------------
# 3. fetch_td_api_usage returns None on HTTP error
# ---------------------------------------------------------------------------

def test_fetch_td_api_usage_returns_none_on_http_error():
    from app.services.market_data import fetch_td_api_usage

    mock_resp = MagicMock()
    mock_resp.raise_for_status.side_effect = Exception("429 Too Many Requests")

    with patch("app.services.market_data.TWELVE_DATA_API_KEY", "fake-key"), \
         patch("app.services.market_data.httpx.get", return_value=mock_resp):
        result = fetch_td_api_usage()

    assert result is None


# ---------------------------------------------------------------------------
# 4. fetch_td_api_usage returns None on non-ok TD status
# ---------------------------------------------------------------------------

def test_fetch_td_api_usage_returns_none_on_error_status():
    from app.services.market_data import fetch_td_api_usage

    mock_resp = MagicMock()
    mock_resp.raise_for_status.return_value = None
    mock_resp.json.return_value = {"status": "error", "code": 401, "message": "invalid key"}

    with patch("app.services.market_data.TWELVE_DATA_API_KEY", "fake-key"), \
         patch("app.services.market_data.httpx.get", return_value=mock_resp):
        result = fetch_td_api_usage()

    assert result is None


# ---------------------------------------------------------------------------
# 5. fetch_td_api_usage returns None on network exception
# ---------------------------------------------------------------------------

def test_fetch_td_api_usage_returns_none_on_exception():
    from app.services.market_data import fetch_td_api_usage

    with patch("app.services.market_data.TWELVE_DATA_API_KEY", "fake-key"), \
         patch("app.services.market_data.httpx.get", side_effect=Exception("network error")):
        result = fetch_td_api_usage()

    assert result is None


# ---------------------------------------------------------------------------
# 6. get_status includes td_api_usage key
# ---------------------------------------------------------------------------

def test_get_status_includes_td_api_usage_key():
    from app.services.scheduler import get_status

    with patch("app.services.scheduler.fetch_td_api_usage", return_value=None):
        status = get_status()

    assert "td_api_usage" in status


# ---------------------------------------------------------------------------
# 7. get_status td_api_usage reflects live fetch result
# ---------------------------------------------------------------------------

def test_get_status_td_api_usage_shows_live_result():
    from app.services.scheduler import get_status

    fake_usage = {"current_usage": 55, "plan_limit": 800}

    with patch("app.services.scheduler.fetch_td_api_usage", return_value=fake_usage):
        status = get_status()

    assert status["td_api_usage"] == fake_usage


# ---------------------------------------------------------------------------
# 8. get_status td_api_usage is None when key not configured
# ---------------------------------------------------------------------------

def test_get_status_td_api_usage_none_when_no_key():
    from app.services.scheduler import get_status

    with patch("app.services.scheduler.fetch_td_api_usage", return_value=None):
        status = get_status()

    assert status["td_api_usage"] is None
