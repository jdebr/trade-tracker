"""
Tests for JWT authentication (app/dependencies.py).

These tests exercise real auth validation — they clear the global auth override
from conftest.py so that get_current_user runs for real.

Criteria:
1. Missing Authorization header returns 401 (HTTPBearer auto-rejects)
2. Token rejected by Supabase returns 401
3. Valid token accepted by Supabase passes auth and reaches the handler
4. GET /health is open — no token required
"""

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from supabase import AuthApiError

from app.dependencies import get_current_user
from app.main import app


@pytest.fixture(autouse=True)
def use_real_auth():
    """Remove the global test override so real auth validation runs for this module."""
    app.dependency_overrides.pop(get_current_user, None)
    yield


def _mock_db():
    mock = MagicMock()
    mock.table.return_value.select.return_value.execute.return_value.data = []
    return mock


@pytest.fixture
def client_valid():
    """TestClient whose Supabase auth.get_user() succeeds."""
    mock_user = MagicMock()
    mock_user.user = {"sub": "test-user-id"}
    with patch("app.dependencies.get_client") as mock_get_client:
        mock_get_client.return_value.auth.get_user.return_value = mock_user
        mock_get_client.return_value.table = _mock_db().table
        yield TestClient(app)


@pytest.fixture
def client_invalid():
    """TestClient whose Supabase auth.get_user() raises AuthApiError."""
    with patch("app.dependencies.get_client") as mock_get_client:
        mock_get_client.return_value.auth.get_user.side_effect = AuthApiError(
            message="invalid JWT", status=401, code="invalid_jwt"
        )
        mock_get_client.return_value.table = _mock_db().table
        yield TestClient(app)


# 1. Missing auth header → 401
def test_missing_auth_header_returns_401(client_valid):
    response = client_valid.get("/watchlist")
    assert response.status_code == 401


# 2. Supabase rejects the token → 401
def test_invalid_token_returns_401(client_invalid):
    response = client_invalid.get("/watchlist", headers={"Authorization": "Bearer bad-token"})
    assert response.status_code == 401


# 3. Valid token passes auth
def test_valid_token_passes_auth(client_valid):
    response = client_valid.get("/watchlist", headers={"Authorization": "Bearer good-token"})
    assert response.status_code != 401
    assert response.status_code != 403


# 4. Health endpoint is open — no token required
def test_health_is_open(client_valid):
    response = client_valid.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
