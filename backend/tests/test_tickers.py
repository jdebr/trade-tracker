"""
Tests for GET /tickers endpoint.

Criteria:
1. GET /tickers returns 200 with a list of {symbol, name} objects
2. GET /tickers filters out ETFs (is_etf=True)
3. GET /tickers returns [] when no non-ETF tickers exist
"""

from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient


def test_get_tickers_returns_200_with_list():
    """GET /tickers returns 200 with a list of {symbol, name} objects."""
    from app.main import app

    mock_client = MagicMock()
    (mock_client.table.return_value
                .select.return_value
                .eq.return_value
                .order.return_value
                .execute.return_value.data) = [
        {"symbol": "AAPL", "name": "Apple Inc."},
        {"symbol": "MSFT", "name": "Microsoft Corporation"},
        {"symbol": "NVDA", "name": "NVIDIA Corporation"},
    ]

    with patch("app.routers.tickers.get_client", return_value=mock_client):
        response = TestClient(app).get("/tickers")

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 3
    assert data[0] == {"symbol": "AAPL", "name": "Apple Inc."}
    assert data[1]["symbol"] == "MSFT"


def test_get_tickers_filters_etfs():
    """GET /tickers queries with is_etf=False."""
    from app.main import app

    mock_client = MagicMock()
    eq_mock = MagicMock()
    (eq_mock.order.return_value.execute.return_value.data) = []
    mock_client.table.return_value.select.return_value.eq.return_value = eq_mock

    with patch("app.routers.tickers.get_client", return_value=mock_client):
        TestClient(app).get("/tickers")

    # Verify .eq("is_etf", False) was called
    mock_client.table.return_value.select.return_value.eq.assert_called_once_with("is_etf", False)


def test_get_tickers_returns_empty_list_when_no_tickers():
    """GET /tickers returns 200 with [] when no non-ETF tickers exist."""
    from app.main import app

    mock_client = MagicMock()
    (mock_client.table.return_value
                .select.return_value
                .eq.return_value
                .order.return_value
                .execute.return_value.data) = []

    with patch("app.routers.tickers.get_client", return_value=mock_client):
        response = TestClient(app).get("/tickers")

    assert response.status_code == 200
    assert response.json() == []
