"""
Tests for signal rules — the data-driven scoring layer (M19a).

Covers the scoring primitive (evaluate_signals), slug/validation helpers, and the
CRUD API's validation + error behavior. The DB is mocked; the rule engine runs for real.
"""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import signal_rules as sr

client = TestClient(app)

BUILTINS = [
    {"slug": "bb_squeeze",       "weight": 1, "expression": {"var": "bb_squeeze"}},
    {"slug": "rsi_in_range",     "weight": 1, "expression": {"<=": [35, {"var": "rsi_14"}, 65]}},
    {"slug": "above_ema50",      "weight": 1, "expression": {">": [{"var": "close"}, {"var": "ema_50"}]}},
    {"slug": "volume_expansion", "weight": 1, "expression": {">": [{"var": "vol_3d"}, {"var": "vol_20d"}]}},
]


def _full_rule(**over):
    base = {
        "id": "sr-1", "slug": "strong_rsi", "name": "Strong RSI", "description": None,
        "type": None, "expression": {"<": [{"var": "rsi_14"}, 30]}, "weight": 1,
        "enabled": True, "is_builtin": False, "sort_order": 0,
        "created_at": "2026-07-20T00:00:00+00:00", "updated_at": "2026-07-20T00:00:00+00:00",
        "deleted_at": None,
    }
    base.update(over)
    return base


# ---------------------------------------------------------------------------
# evaluate_signals — the shared scoring primitive
# ---------------------------------------------------------------------------

def test_evaluate_signals_full_score_and_normalized():
    features = {"bb_squeeze": True, "rsi_14": 50.0, "close": 100.0, "ema_50": 95.0,
                "vol_3d": 2, "vol_20d": 1}
    res = sr.evaluate_signals(features, BUILTINS)
    assert res["signals"] == {
        "bb_squeeze": True, "rsi_in_range": True, "above_ema50": True, "volume_expansion": True,
    }
    assert res["signal_score"] == 4
    assert res["max_signal_score"] == 4
    assert res["signal_score_normalized"] == 1.0


def test_evaluate_signals_partial_score():
    features = {"bb_squeeze": False, "rsi_14": 50.0, "close": 90.0, "ema_50": 95.0,
                "vol_3d": 1, "vol_20d": 1}
    res = sr.evaluate_signals(features, BUILTINS)  # only rsi_in_range fires
    assert res["signal_score"] == 1
    assert res["signal_score_normalized"] == 0.25


def test_evaluate_signals_respects_weights():
    rules = [
        {"slug": "a", "weight": 2, "expression": {"var": "x"}},
        {"slug": "b", "weight": 1, "expression": {"var": "y"}},
    ]
    res = sr.evaluate_signals({"x": True, "y": False}, rules)
    assert res["signal_score"] == 2
    assert res["max_signal_score"] == 3
    assert res["signal_score_normalized"] == round(2 / 3, 4)


def test_evaluate_signals_null_safe_on_missing_var():
    res = sr.evaluate_signals({"bb_squeeze": True}, BUILTINS)  # rsi/close/vols missing
    assert res["signals"]["bb_squeeze"] is True
    assert res["signals"]["rsi_in_range"] is False  # missing rsi never satisfies


def test_evaluate_signals_bad_rule_counts_as_false_not_crash():
    rules = [{"slug": "broken", "weight": 1, "expression": {"bogus_op": [1, 2]}}]
    res = sr.evaluate_signals({}, rules)
    assert res["signals"]["broken"] is False
    assert res["max_signal_score"] == 1  # still in the denominator


def test_evaluate_signals_empty_rules():
    assert sr.evaluate_signals({}, []) == {
        "signals": {}, "signal_score": 0, "max_signal_score": 0, "signal_score_normalized": None,
    }


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("name, slug", [
    ("BB Squeeze", "bb_squeeze"),
    ("  RSI < 30 !! ", "rsi_30"),
    ("MACD>0", "macd_0"),
    ("!!!", "signal"),
])
def test_slugify(name, slug):
    assert sr.slugify(name) == slug


def test_validate_expression_ok():
    assert sr.validate_expression({"<": [{"var": "rsi_14"}, 35]}) == []


def test_validate_expression_unknown_var():
    assert any("unknown" in e for e in sr.validate_expression({"<": [{"var": "nope"}, 5]}))


# ---------------------------------------------------------------------------
# CRUD API
# ---------------------------------------------------------------------------

def test_create_rejects_invalid_expression_422():
    resp = client.post("/signal-rules", json={"name": "Bad", "expression": {"<": [{"var": "nope"}, 5]}})
    assert resp.status_code == 422


def test_create_ok_generates_slug():
    with patch("app.routers.signal_rules.sr.get_rule_by_slug", return_value=None), \
         patch("app.routers.signal_rules.sr.create_rule", return_value=_full_rule(slug="strong_rsi")):
        resp = client.post("/signal-rules", json={
            "name": "Strong RSI", "expression": {"<": [{"var": "rsi_14"}, 30]},
        })
    assert resp.status_code == 201
    assert resp.json()["slug"] == "strong_rsi"


def test_create_duplicate_slug_409():
    with patch("app.routers.signal_rules.sr.get_rule_by_slug", return_value=_full_rule()):
        resp = client.post("/signal-rules", json={"name": "BB Squeeze", "expression": {"var": "bb_squeeze"}})
    assert resp.status_code == 409


def test_get_missing_rule_404():
    with patch("app.routers.signal_rules.sr.get_rule", return_value=None):
        resp = client.get("/signal-rules/nope")
    assert resp.status_code == 404


def test_patch_rejects_expression_change_as_immutable():
    # The expression is frozen once created — editing it would silently change the
    # meaning of every historical attribution. Must be rejected, not ignored.
    resp = client.patch("/signal-rules/sr-1", json={"expression": {"var": "bb_squeeze"}})
    assert resp.status_code == 422


def test_patch_rejects_slug_change_as_immutable():
    resp = client.patch("/signal-rules/sr-1", json={"slug": "new_slug"})
    assert resp.status_code == 422


def test_patch_allows_mutable_fields():
    updated = _full_rule(name="Renamed", weight=3, enabled=False)
    with patch("app.routers.signal_rules.sr.get_rule", return_value=_full_rule()), \
         patch("app.routers.signal_rules.sr.update_rule", return_value=updated) as m:
        resp = client.patch("/signal-rules/sr-1", json={"name": "Renamed", "weight": 3, "enabled": False})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"
    # expression is never part of an update payload
    assert "expression" not in m.call_args[0][1]


def test_patch_rejects_name_plus_expression_wholesale():
    # A mutable field mixed with an immutable one is rejected entirely — the name
    # must not be partially applied while the expression is dropped.
    with patch("app.routers.signal_rules.sr.update_rule") as m:
        resp = client.patch("/signal-rules/sr-1", json={"name": "X", "expression": {"var": "bb_squeeze"}})
    assert resp.status_code == 422
    m.assert_not_called()


def test_disabling_a_builtin_logs_a_warning(caplog):
    builtin = _full_rule(slug="bb_squeeze", is_builtin=True)
    with patch("app.routers.signal_rules.sr.get_rule", return_value=builtin), \
         patch("app.routers.signal_rules.sr.update_rule",
               return_value=_full_rule(slug="bb_squeeze", is_builtin=True, enabled=False)), \
         caplog.at_level("WARNING"):
        resp = client.patch("/signal-rules/sr-1", json={"enabled": False})
    assert resp.status_code == 200
    assert "builtin signal" in caplog.text


def test_delete_soft_deletes():
    with patch("app.routers.signal_rules.sr.get_rule", return_value=_full_rule()), \
         patch("app.routers.signal_rules.sr.soft_delete_rule",
               return_value=_full_rule(enabled=False, deleted_at="2026-07-20T01:00:00+00:00")) as m:
        resp = client.delete("/signal-rules/sr-1")
    assert resp.status_code == 200
    assert resp.json()["deleted_at"] is not None
    m.assert_called_once_with("sr-1")


def test_list_rules_endpoint():
    with patch("app.routers.signal_rules.sr.list_rules", return_value=[_full_rule()]):
        resp = client.get("/signal-rules")
    assert resp.status_code == 200
    assert resp.json()[0]["slug"] == "strong_rsi"


# ---------------------------------------------------------------------------
# update_rule payload — explicit nulls must clear fields, not be dropped
# ---------------------------------------------------------------------------

def test_update_rule_applies_explicit_nulls():
    """The router sends model_dump(exclude_unset=True), so a present None means
    'clear it'. update_rule must pass those through, not filter them out."""
    captured = {}

    class _Update:
        def eq(self, *a, **k):
            return self
        def execute(self):
            return type("R", (), {"data": [{"id": "x"}]})()

    class _Table:
        def update(self, payload):
            captured.update(payload)
            return _Update()

    class _Client:
        def table(self, _name):
            return _Table()

    with patch("app.services.signal_rules.get_client", return_value=_Client()):
        sr.update_rule("x", {"name": "Renamed", "description": None, "type": None, "weight": 3})

    assert captured["name"] == "Renamed"
    assert captured["description"] is None   # cleared, not dropped
    assert captured["type"] is None
    assert captured["weight"] == 3
    assert "updated_at" in captured
