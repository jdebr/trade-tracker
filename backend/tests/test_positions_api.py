"""
Tests for the positions API and the persistence service.

Only the Supabase client is mocked — the real router and service code runs, so
the risk maths, the outcome maths, and the event-log writes are genuinely
exercised rather than stubbed over.

Fixture arithmetic (same as test_exit_strategy):
    entry 100.00, stop 94.00 → risk/share 6.00, 16 shares → 1R = $96
"""

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.exit_strategy import MarketContext
from app.services.settings import DEFAULTS

client = TestClient(app)


SNAPSHOT = {
    "symbol": "AAPL", "date": "2026-07-10",
    "rsi_14": 50.0, "macd_hist": 0.42,
    "bb_upper": 108.0, "bb_middle": 100.0, "bb_lower": 94.0,
    "bb_width": 0.14, "bb_squeeze": True,
    "ema_8": 99.0, "ema_21": 96.0, "ema_50": 92.0,
    "atr_14": 3.0, "obv": 1_000_000,
}

BARS = [
    {"symbol": "AAPL", "date": f"2026-07-{i:02d}", "open": 100.0, "high": 102.0,
     "low": 97.0, "close": 101.0, "volume": 1_000_000}
    for i in range(1, 11)
]

CTX = MarketContext(symbol="AAPL", snapshot=SNAPSHOT, bars=BARS)

OPEN_POSITION = {
    "id": "pos-1",
    "symbol": "AAPL",
    "direction": "long",
    "is_simulated": True,
    "status": "open",
    "alert_id": None,
    "screener_result_id": None,
    "entry_date": "2026-07-01",
    "entry_price": 100.0,
    "shares": 16.0,
    "position_value": 1600.0,
    "initial_stop_price": 94.0,
    "stop_price": 94.0,
    "target_price": 112.0,
    "stop_method": "atr_multiple",
    "target_method": "r_multiple",
    "exit_plan": {},
    "time_stop_date": None,
    "risk_per_share": 6.0,
    "risk_amount": 96.0,
    "entry_signals": {"bb_squeeze": True, "signal_score": 3},
    "exit_date": None, "exit_price": None, "exit_reason": None,
    "pnl": None, "pnl_pct": None, "r_multiple": None, "hold_days": None,
    "notes": None,
    "created_at": "2026-07-01T14:00:00+00:00",
    "updated_at": "2026-07-01T14:00:00+00:00",
}


def _mock_db(table_data: dict | None = None):
    """
    Mock Supabase client. `table_data` maps table name → the list `execute()`
    should return as `.data` for any query against that table.

    Chains are cached per table name so that `db.table("positions")` returns the
    same mock every time. Without the cache, asserting on `.insert.call_args`
    after the request would inspect a freshly-minted mock that never saw the call.
    """
    table_data = table_data or {}
    chains: dict[str, MagicMock] = {}

    def make_chain(data):
        chain = MagicMock()
        for method in (
            "select", "insert", "update", "delete", "upsert",
            "eq", "in_", "gt", "gte", "lt", "lte", "order", "limit",
        ):
            getattr(chain, method).return_value = chain
        result = MagicMock()
        result.data = data
        chain.execute.return_value = result
        return chain

    def get_table(name):
        if name not in chains:
            chains[name] = make_chain(table_data.get(name, []))
        return chains[name]

    db = MagicMock()
    db.table.side_effect = get_table
    return db


@pytest.fixture
def settings_patch():
    with patch("app.services.settings.get_settings", return_value=dict(DEFAULTS)), \
         patch("app.routers.positions.settings_svc.get_settings", return_value=dict(DEFAULTS)):
        yield


# ---------------------------------------------------------------------------
# POST /positions/plan — the exit strategy builder
# ---------------------------------------------------------------------------

def test_plan_returns_levels_sizing_and_alternatives(settings_patch):
    with patch("app.routers.positions.load_market_context", return_value=CTX):
        response = client.post("/positions/plan", json={"symbol": "AAPL", "entry_price": 100.0})

    assert response.status_code == 200
    plan = response.json()

    assert plan["stop_price"]     == 94.0
    assert plan["target_price"]   == 112.0
    assert plan["risk_per_share"] == 6.0
    assert plan["rr_ratio"]       == 2.0
    assert plan["shares"]         == 16
    assert plan["risk_amount"]    == 96.0
    assert plan["warnings"]       == []

    # The comparison table — the point of calling it a "builder".
    assert plan["stop_candidates"]["bb_lower"]  == 94.0
    assert plan["stop_candidates"]["ema_21"]    == 96.0
    assert plan["target_candidates"]["bb_upper"] == 108.0


def test_plan_honours_overrides(settings_patch):
    with patch("app.routers.positions.load_market_context", return_value=CTX):
        response = client.post("/positions/plan", json={
            "symbol": "AAPL", "entry_price": 100.0,
            "stop_method": "percent", "stop_pct": 10.0,
            "risk_pct": 2.0,
        })

    plan = response.json()
    assert plan["stop_price"]     == 90.0
    assert plan["risk_per_share"] == 10.0
    assert plan["shares"]         == 20      # $10k * 2% = $200 / $10


def test_plan_404s_when_the_symbol_has_no_indicator_data(settings_patch):
    empty = MarketContext(symbol="ZZZZ", snapshot=None, bars=[])
    with patch("app.routers.positions.load_market_context", return_value=empty):
        response = client.post("/positions/plan", json={"symbol": "ZZZZ", "entry_price": 100.0})

    assert response.status_code == 404
    assert "Run a scan" in response.json()["detail"]


def test_plan_400s_when_the_stop_is_above_entry(settings_patch):
    with patch("app.routers.positions.load_market_context", return_value=CTX):
        response = client.post("/positions/plan", json={
            "symbol": "AAPL", "entry_price": 100.0,
            "stop_method": "manual", "manual_stop": 105.0,
        })

    assert response.status_code == 400
    assert "must be below the entry price" in response.json()["detail"]


# ---------------------------------------------------------------------------
# POST /positions — open
# ---------------------------------------------------------------------------

def test_open_position_computes_risk_server_side_and_logs_an_opened_event():
    db = _mock_db({"positions": [OPEN_POSITION], "position_events": [{"id": "evt-1"}]})

    with patch("app.routers.positions.get_client", return_value=db), \
         patch("app.services.positions.get_client", return_value=db), \
         patch("app.routers.positions.load_market_context", return_value=CTX), \
         patch("app.routers.positions.pos_svc.get_recent_alert_types", return_value=["bb_squeeze"]):
        response = client.post("/positions", json={
            "symbol": "AAPL", "entry_price": 100.0, "shares": 16, "stop_price": 94.0,
            "target_price": 112.0,
        })

    assert response.status_code == 201

    # Risk is derived from (entry, stop, shares) on the server, not trusted from
    # the client — inspect the row that was actually inserted.
    inserted = db.table("positions").insert.call_args[0][0]
    assert inserted["risk_per_share"]     == 6.0
    assert inserted["risk_amount"]        == 96.0
    assert inserted["position_value"]     == 1600.0
    assert inserted["initial_stop_price"] == 94.0     # frozen at entry
    assert inserted["stop_price"]         == 94.0

    # Signal attribution captured at entry — this is what the reports group by.
    assert inserted["entry_signals"]["bb_squeeze"] is True
    assert inserted["entry_signals"]["rsi_in_range"] is True
    assert inserted["entry_signals"]["triggering_alert_types"] == ["bb_squeeze"]

    event = db.table("position_events").insert.call_args[0][0]
    assert event["event_type"]  == "opened"
    assert event["position_id"] == "pos-1"
    assert event["price"]       == 100.0


def test_open_position_defaults_to_simulated():
    """Real money is opt-in. A request that says nothing gets a paper trade."""
    db = _mock_db({"positions": [OPEN_POSITION], "position_events": [{"id": "evt-1"}]})

    with patch("app.routers.positions.get_client", return_value=db), \
         patch("app.services.positions.get_client", return_value=db), \
         patch("app.routers.positions.load_market_context", return_value=CTX), \
         patch("app.routers.positions.pos_svc.get_recent_alert_types", return_value=[]):
        client.post("/positions", json={
            "symbol": "AAPL", "entry_price": 100.0, "shares": 16, "stop_price": 94.0,
        })

    assert db.table("positions").insert.call_args[0][0]["is_simulated"] is True


def test_open_position_rejects_a_stop_above_entry():
    db = _mock_db({"positions": [OPEN_POSITION]})

    with patch("app.routers.positions.get_client", return_value=db), \
         patch("app.routers.positions.load_market_context", return_value=CTX):
        response = client.post("/positions", json={
            "symbol": "AAPL", "entry_price": 100.0, "shares": 16, "stop_price": 105.0,
        })

    assert response.status_code == 400
    assert "must be below the entry price" in response.json()["detail"]


# ---------------------------------------------------------------------------
# GET /positions
# ---------------------------------------------------------------------------

def test_list_positions_returns_rows():
    db = _mock_db({"positions": [OPEN_POSITION]})

    with patch("app.routers.positions.get_client", return_value=db):
        response = client.get("/positions?status=open")

    assert response.status_code == 200
    assert response.json()[0]["symbol"] == "AAPL"


def test_get_position_includes_its_event_log():
    events = [{
        "id": "evt-1", "position_id": "pos-1", "event_type": "opened",
        "occurred_at": "2026-07-01T14:00:00+00:00", "price": 100.0,
        "payload": {"shares": 16}, "alert_id": None,
    }]
    db = _mock_db({"positions": [OPEN_POSITION], "position_events": events})

    with patch("app.services.positions.get_client", return_value=db):
        response = client.get("/positions/pos-1")

    assert response.status_code == 200
    body = response.json()
    assert body["symbol"] == "AAPL"
    assert body["events"][0]["event_type"] == "opened"


def test_get_missing_position_404s():
    db = _mock_db({"positions": []})

    with patch("app.services.positions.get_client", return_value=db):
        response = client.get("/positions/nope")

    assert response.status_code == 404


# ---------------------------------------------------------------------------
# POST /positions/{id}/close
# ---------------------------------------------------------------------------

def test_close_position_computes_pnl_and_r_multiple():
    db = _mock_db({"positions": [OPEN_POSITION], "position_events": [{"id": "evt-2"}]})

    with patch("app.services.positions.get_client", return_value=db):
        response = client.post("/positions/pos-1/close", json={
            "exit_price": 112.0, "exit_date": "2026-07-09", "exit_reason": "target_hit",
        })

    assert response.status_code == 200

    # Assert on what was written, not what the mock echoed back.
    updates = db.table("positions").update.call_args[0][0]
    assert updates["status"]     == "closed"
    assert updates["pnl"]        == 192.0      # (112 - 100) * 16
    assert updates["pnl_pct"]    == 12.0
    assert updates["r_multiple"] == 2.0        # 12 / 6 — a clean 2R win
    assert updates["hold_days"]  == 8

    event = db.table("position_events").insert.call_args[0][0]
    assert event["event_type"] == "closed"
    assert event["payload"]["r_multiple"] == 2.0


def test_closing_at_the_stop_is_a_minus_one_r_loss():
    db = _mock_db({"positions": [OPEN_POSITION], "position_events": [{"id": "evt-2"}]})

    with patch("app.services.positions.get_client", return_value=db):
        client.post("/positions/pos-1/close", json={
            "exit_price": 94.0, "exit_date": "2026-07-03", "exit_reason": "stop_hit",
        })

    updates = db.table("positions").update.call_args[0][0]
    assert updates["pnl"]        == -96.0
    assert updates["r_multiple"] == -1.0


def test_cannot_close_an_already_closed_position():
    db = _mock_db({"positions": [{**OPEN_POSITION, "status": "closed"}]})

    with patch("app.services.positions.get_client", return_value=db):
        response = client.post("/positions/pos-1/close", json={"exit_price": 112.0})

    assert response.status_code == 400
    assert "already closed" in response.json()["detail"]


def test_exit_date_cannot_precede_entry_date():
    db = _mock_db({"positions": [OPEN_POSITION]})

    with patch("app.services.positions.get_client", return_value=db):
        response = client.post("/positions/pos-1/close", json={
            "exit_price": 112.0, "exit_date": "2026-06-01",
        })

    assert response.status_code == 400
    assert "cannot precede" in response.json()["detail"]


# ---------------------------------------------------------------------------
# PATCH /positions/{id}
# ---------------------------------------------------------------------------

def test_moving_the_stop_logs_a_stop_moved_event():
    # Position's current stop is 94.0 (from OPEN_POSITION); we raise it to 98.0.
    db = _mock_db({"positions": [OPEN_POSITION], "position_events": [{"id": "evt-3"}]})

    with patch("app.routers.positions.get_client", return_value=db), \
         patch("app.services.positions.get_client", return_value=db):
        response = client.patch("/positions/pos-1", json={"stop_price": 98.0})

    assert response.status_code == 200

    event = db.table("position_events").insert.call_args[0][0]
    assert event["event_type"]       == "stop_moved"
    assert event["payload"]["old_stop"] == 94.0
    assert event["payload"]["new_stop"] == 98.0


def test_patch_rejects_a_stop_at_or_above_entry():
    db = _mock_db({"positions": [OPEN_POSITION]})

    with patch("app.routers.positions.get_client", return_value=db), \
         patch("app.services.positions.get_client", return_value=db):
        response = client.patch("/positions/pos-1", json={"stop_price": 100.0})

    assert response.status_code == 400


def test_cannot_revise_a_closed_position():
    db = _mock_db({"positions": [{**OPEN_POSITION, "status": "closed"}]})

    with patch("app.routers.positions.get_client", return_value=db), \
         patch("app.services.positions.get_client", return_value=db):
        response = client.patch("/positions/pos-1", json={"stop_price": 96.0})

    assert response.status_code == 400
    assert "only open positions" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

def test_get_settings_returns_defaults():
    db = _mock_db({"app_settings": [{**DEFAULTS, "updated_at": "2026-07-01T00:00:00+00:00"}]})

    with patch("app.services.settings.get_client", return_value=db):
        response = client.get("/settings")

    assert response.status_code == 200
    body = response.json()
    assert body["account_size"]        == 10000.0
    assert body["risk_per_trade_pct"]  == 1.0
    assert body["default_stop_method"] == "atr_multiple"


def test_update_settings_persists_the_change():
    updated = {**DEFAULTS, "account_size": 25000.0, "updated_at": "2026-07-01T00:00:00+00:00"}
    db = _mock_db({"app_settings": [updated]})

    with patch("app.services.settings.get_client", return_value=db):
        response = client.patch("/settings", json={"account_size": 25000})

    assert response.status_code == 200
    assert response.json()["account_size"] == 25000.0


def test_update_settings_rejects_an_unknown_stop_method():
    db = _mock_db({"app_settings": [DEFAULTS]})

    with patch("app.services.settings.get_client", return_value=db):
        response = client.patch("/settings", json={"default_stop_method": "astrology"})

    assert response.status_code == 400
    assert "Unknown stop method" in response.json()["detail"]
