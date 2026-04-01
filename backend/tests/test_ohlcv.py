"""
Tests for the OHLCV cache layer (app/services/ohlcv_cache.py).

All DB calls are mocked — no real Supabase connection required.

Criteria:
1. is_cache_fresh returns True when the most recent bar is within the stale threshold
2. is_cache_fresh returns False when there are no bars (empty cache)
3. is_cache_fresh returns False when the most recent bar is too old
4. upsert_bars returns the correct row count
5. upsert_bars returns 0 for an empty list (no DB call)
6. get_cached_bars returns bars in oldest→newest order
7. yfinance fallback activates when fetch_from_twelve_data raises TwelveDataError
"""

from datetime import date, timedelta
from unittest.mock import MagicMock, patch
import pytest

from app.services.ohlcv_cache import is_cache_fresh, upsert_bars, get_cached_bars
from app.services.market_data import fetch_ohlcv, TwelveDataError


def _make_bar(symbol: str, bar_date: str, source: str = "yfinance") -> dict:
    return {
        "symbol": symbol, "date": bar_date,
        "open": 100.0, "high": 105.0, "low": 99.0,
        "close": 103.0, "volume": 1_000_000, "source": source,
    }


# ---------------------------------------------------------------------------
# 1. is_cache_fresh — fresh bar
# ---------------------------------------------------------------------------

def test_is_cache_fresh_returns_true_for_recent_bar():
    today = date.today().isoformat()

    mock_client = MagicMock()
    (mock_client.table.return_value
                .select.return_value
                .eq.return_value
                .order.return_value
                .limit.return_value
                .execute.return_value.data) = [{"date": today}]

    with patch("app.services.ohlcv_cache.get_client", return_value=mock_client):
        assert is_cache_fresh("AAPL") is True


# ---------------------------------------------------------------------------
# 2. is_cache_fresh — empty cache
# ---------------------------------------------------------------------------

def test_is_cache_fresh_returns_false_when_no_bars():
    mock_client = MagicMock()
    (mock_client.table.return_value
                .select.return_value
                .eq.return_value
                .order.return_value
                .limit.return_value
                .execute.return_value.data) = []

    with patch("app.services.ohlcv_cache.get_client", return_value=mock_client):
        assert is_cache_fresh("AAPL") is False


# ---------------------------------------------------------------------------
# 3. is_cache_fresh — stale bar
# ---------------------------------------------------------------------------

def test_is_cache_fresh_returns_false_for_old_bar():
    old_date = (date.today() - timedelta(days=5)).isoformat()

    mock_client = MagicMock()
    (mock_client.table.return_value
                .select.return_value
                .eq.return_value
                .order.return_value
                .limit.return_value
                .execute.return_value.data) = [{"date": old_date}]

    with patch("app.services.ohlcv_cache.get_client", return_value=mock_client):
        assert is_cache_fresh("AAPL") is False


# ---------------------------------------------------------------------------
# 4. upsert_bars — returns correct row count
# ---------------------------------------------------------------------------

def test_upsert_bars_returns_row_count():
    bars = [_make_bar("AAPL", "2026-04-01"), _make_bar("AAPL", "2026-03-31")]

    mock_client = MagicMock()
    (mock_client.table.return_value
                .upsert.return_value
                .execute.return_value.data) = bars  # supabase returns upserted rows

    with patch("app.services.ohlcv_cache.get_client", return_value=mock_client):
        count = upsert_bars(bars)

    assert count == 2


# ---------------------------------------------------------------------------
# 5. upsert_bars — empty list skips DB call
# ---------------------------------------------------------------------------

def test_upsert_bars_empty_list_returns_zero():
    mock_client = MagicMock()

    with patch("app.services.ohlcv_cache.get_client", return_value=mock_client):
        count = upsert_bars([])

    mock_client.table.assert_not_called()
    assert count == 0


# ---------------------------------------------------------------------------
# 6. get_cached_bars — returns oldest→newest order
# ---------------------------------------------------------------------------

def test_get_cached_bars_returns_oldest_to_newest():
    # Supabase returns desc order; get_cached_bars should reverse to asc
    desc_bars = [
        _make_bar("AAPL", "2026-04-02"),
        _make_bar("AAPL", "2026-04-01"),
        _make_bar("AAPL", "2026-03-31"),
    ]

    mock_client = MagicMock()
    (mock_client.table.return_value
                .select.return_value
                .eq.return_value
                .order.return_value
                .limit.return_value
                .execute.return_value.data) = desc_bars

    with patch("app.services.ohlcv_cache.get_client", return_value=mock_client):
        result = get_cached_bars("AAPL", limit=3)

    assert [r["date"] for r in result] == ["2026-03-31", "2026-04-01", "2026-04-02"]


# ---------------------------------------------------------------------------
# 7. yfinance fallback activates on TwelveDataError
# ---------------------------------------------------------------------------

def test_yfinance_fallback_on_twelve_data_error():
    fake_bars = [_make_bar("MSFT", date.today().isoformat(), source="yfinance")]

    with patch("app.services.market_data.fetch_from_twelve_data",
               side_effect=TwelveDataError("rate limit")), \
         patch("app.services.market_data.fetch_from_yfinance",
               return_value=fake_bars) as mock_yf:
        result = fetch_ohlcv("MSFT", lookback_days=5)

    mock_yf.assert_called_once_with("MSFT", 5)
    assert result == fake_bars
    assert result[0]["source"] == "yfinance"
