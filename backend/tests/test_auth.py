"""
Tests for JWT authentication (app/dependencies.py).

These tests exercise real JWT validation — they clear the global auth override
from conftest.py so that get_current_user runs with actual token verification.

Criteria:
1. Missing Authorization header returns 401 (HTTPBearer auto-rejects)
2. Malformed / wrong-secret token returns 401
3. Expired token returns 401
4. Valid token passes auth and reaches the handler
5. GET /health is open — no token required
"""

import time
from unittest.mock import MagicMock, patch

import jwt
import pytest
from fastapi.testclient import TestClient

from app.dependencies import get_current_user
from app.main import app

TEST_SECRET = "test-secret-at-least-32-characters-long-for-hs256"


def _make_token(expired: bool = False, wrong_secret: bool = False) -> str:
    secret = "wrong-secret" if wrong_secret else TEST_SECRET
    payload = {
        "sub": "test-user-id",
        "aud": "authenticated",
        "exp": int(time.time()) + (-10 if expired else 3600),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


@pytest.fixture(autouse=True)
def use_real_auth():
    """Remove the global test override so real JWT validation runs for this module."""
    app.dependency_overrides.pop(get_current_user, None)
    yield


@pytest.fixture
def client():
    """TestClient with a mocked DB and the test JWT secret patched in."""
    mock_db = MagicMock()
    mock_db.table.return_value.select.return_value.execute.return_value.data = []
    with patch("app.dependencies._jwt_secret", TEST_SECRET):
        with patch("app.database.get_client", return_value=mock_db):
            yield TestClient(app)


# 1. Missing auth header → 401
def test_missing_auth_header_returns_401(client):
    response = client.get("/watchlist")
    assert response.status_code == 401


# 2. Wrong-secret token → 401
def test_invalid_token_returns_401(client):
    token = _make_token(wrong_secret=True)
    response = client.get("/watchlist", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert "Invalid token" in response.json()["detail"]


# 3. Expired token → 401
def test_expired_token_returns_401(client):
    token = _make_token(expired=True)
    response = client.get("/watchlist", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert "Token expired" in response.json()["detail"]


# 4. Valid token passes auth (handler runs — may return 200 or other non-401)
def test_valid_token_passes_auth(client):
    token = _make_token()
    response = client.get("/watchlist", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code != 401
    assert response.status_code != 403


# 5. Health endpoint is open — no token required
def test_health_is_open(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
