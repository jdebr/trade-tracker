import pytest
from app.main import app
from app.dependencies import get_current_user


@pytest.fixture(autouse=True)
def override_auth():
    """Bypass JWT auth for all tests — each test gets a fake authenticated user."""
    app.dependency_overrides[get_current_user] = lambda: {"sub": "test-user-id"}
    yield
    app.dependency_overrides.clear()
