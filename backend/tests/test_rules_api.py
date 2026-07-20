"""
Tests for the /rules endpoints — wiring + response shapes.

Only build_feature_context is mocked (for preview); the real router, engine, and
registry run, so validation and evaluation are genuinely exercised.
"""

from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_list_variables_returns_registry():
    resp = client.get("/rules/variables")
    assert resp.status_code == 200
    variables = resp.json()["variables"]
    names = {v["name"] for v in variables}
    assert {"rsi_14", "bb_squeeze", "close", "vol_3d"} <= names
    # every entry carries the display metadata the builder needs
    for v in variables:
        assert v.keys() >= {"name", "type", "label", "group", "description"}


def test_validate_valid_rule():
    resp = client.post("/rules/validate", json={"rule": {"<": [{"var": "rsi_14"}, 35]}})
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is True
    assert body["errors"] == []
    assert body["variables_used"] == ["rsi_14"]
    assert body["formatted"] == "RSI(14) < 35"


def test_validate_unknown_variable():
    resp = client.post("/rules/validate", json={"rule": {"<": [{"var": "nope"}, 35]}})
    body = resp.json()
    assert body["valid"] is False
    assert any("unknown variable" in e for e in body["errors"])


def test_preview_evaluates_against_feature_context():
    features = {"rsi_14": 30.0, "bb_squeeze": True, "close": 102.0, "ema_50": 100.0}
    rule = {"and": [{"<": [{"var": "rsi_14"}, 35]}, {"var": "bb_squeeze"}]}
    with patch("app.routers.rules.build_feature_context", return_value=features):
        resp = client.post("/rules/preview", json={"rule": rule, "symbol": "aapl"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["symbol"] == "AAPL"
    assert body["value"] is True
    assert body["features_used"] == {"rsi_14": 30.0, "bb_squeeze": True}
    assert body["errors"] == []


def test_preview_returns_errors_without_evaluating_when_invalid():
    with patch("app.routers.rules.build_feature_context") as mocked:
        resp = client.post("/rules/preview", json={"rule": {"<": [{"var": "nope"}, 35]}, "symbol": "aapl"})
    body = resp.json()
    assert body["value"] is False
    assert any("unknown variable" in e for e in body["errors"])
    mocked.assert_not_called()  # invalid rule must never hit the DB


import pytest


@pytest.mark.parametrize("rule", [
    {"and": 5},          # args not a list
    {"!": 5},            # unary with non-list args
    {"<": 5},            # comparison with non-list args
    {"var": {"x": 1}},   # var name is an unhashable non-string
    {"and": [{"!": 5}]}, # malformed nested inside a valid wrapper
])
def test_validate_malformed_returns_errors_not_500(rule):
    # These are exactly the structurally-broken rules /validate exists to reject
    # gracefully — they must never crash format_human into a 500.
    resp = client.post("/rules/validate", json={"rule": rule})
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is False
    assert body["errors"]  # non-empty


def test_preview_malformed_returns_errors_not_500():
    with patch("app.routers.rules.build_feature_context") as mocked:
        resp = client.post("/rules/preview", json={"rule": {"and": 5}, "symbol": "aapl"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["value"] is False
    assert body["errors"]
    mocked.assert_not_called()
