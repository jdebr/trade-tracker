"""
Tests for the position monitor — alerts on OPEN trades.

Distinct from the opportunity alerts the scanner and intraday poller fire. The
two share the `alerts` table and are separated by `category`; several tests here
pin down that the separation actually holds.

Fixture position: entry 100.00, stop 94.00, target 112.00, 16 shares.
    → risk/share 6.00, so unrealized R = (price - 100) / 6
"""

from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import pytest

from app.services.exit_strategy import MarketContext
from app.services.position_monitor import (
    apply_trailing_stop,
    evaluate_position_conditions,
    run_position_monitor,
)

TODAY = date(2026, 7, 13)

POSITION = {
    "id": "pos-1",
    "symbol": "AAPL",
    "is_simulated": True,
    "status": "open",
    "entry_date": "2026-07-01",
    "entry_price": 100.0,
    "shares": 16.0,
    "initial_stop_price": 94.0,
    "stop_price": 94.0,
    "target_price": 112.0,
    "risk_per_share": 6.0,
    "risk_amount": 96.0,
    "time_stop_date": None,
    "exit_plan": {},
}


def _pos(**overrides):
    return {**POSITION, **overrides}


# ---------------------------------------------------------------------------
# Conditions
# ---------------------------------------------------------------------------

def test_stop_hit_fires_when_price_reaches_the_stop():
    alerts, _ = evaluate_position_conditions(_pos(), current_price=93.50, existing=set(), today=TODAY)

    assert len(alerts) == 1
    assert alerts[0]["alert_type"]  == "stop_hit"
    assert alerts[0]["category"]    == "position"
    assert alerts[0]["position_id"] == "pos-1"
    assert alerts[0]["details"]["unrealized_r"] == pytest.approx(-1.08, abs=0.01)


def test_target_hit_fires_when_price_reaches_the_target():
    alerts, _ = evaluate_position_conditions(_pos(), current_price=112.0, existing=set(), today=TODAY)

    assert len(alerts) == 1
    assert alerts[0]["alert_type"] == "target_hit"
    assert alerts[0]["category"]   == "position"
    # 112 is exactly the 2R target.
    assert alerts[0]["details"]["unrealized_r"] == pytest.approx(2.0)


def test_approaching_target_fires_within_the_threshold():
    # 110.50 is 1.34% below the 112 target — inside the 2% band.
    alerts, _ = evaluate_position_conditions(_pos(), current_price=110.50, existing=set(), today=TODAY)

    assert [a["alert_type"] for a in alerts] == ["approaching_target"]
    assert alerts[0]["details"]["distance_pct"] == pytest.approx(1.34, abs=0.01)


def test_approaching_target_does_not_fire_alongside_target_hit():
    """
    Both firing on the same tick would be pure noise — "you're nearly there" is
    worthless once you've arrived.
    """
    alerts, _ = evaluate_position_conditions(_pos(), current_price=113.0, existing=set(), today=TODAY)

    assert [a["alert_type"] for a in alerts] == ["target_hit"]


def test_no_alerts_when_price_sits_between_stop_and_target():
    alerts, _ = evaluate_position_conditions(_pos(), current_price=103.0, existing=set(), today=TODAY)
    assert alerts == []


def test_time_stop_fires_when_the_date_passes():
    position = _pos(time_stop_date=(TODAY - timedelta(days=1)).isoformat())
    alerts, _ = evaluate_position_conditions(position, current_price=103.0, existing=set(), today=TODAY)

    assert [a["alert_type"] for a in alerts] == ["time_stop_reached"]
    assert alerts[0]["details"]["hold_days"] == 12


def test_time_stop_fires_alongside_a_price_condition():
    """
    Time stop is evaluated independently of the price conditions — a trade can be
    both past its deadline and sitting on its stop.
    """
    position = _pos(time_stop_date=(TODAY - timedelta(days=1)).isoformat())
    alerts, _ = evaluate_position_conditions(position, current_price=93.0, existing=set(), today=TODAY)

    assert sorted(a["alert_type"] for a in alerts) == ["stop_hit", "time_stop_reached"]


def test_position_without_a_target_only_watches_the_stop():
    alerts, _ = evaluate_position_conditions(
        _pos(target_price=None), current_price=150.0, existing=set(), today=TODAY,
    )
    assert alerts == []


# ---------------------------------------------------------------------------
# Dedup
# ---------------------------------------------------------------------------

def test_dedup_suppresses_a_repeat_alert_on_the_same_position_today():
    existing = {("pos-1", "stop_hit")}
    alerts, skipped = evaluate_position_conditions(
        _pos(), current_price=93.0, existing=existing, today=TODAY,
    )

    assert alerts == []
    assert skipped == 1


def test_dedup_is_keyed_on_position_not_symbol():
    """
    Two open positions in the same name each get their own alert. Keying dedup on
    symbol would silently swallow the second one.
    """
    existing = {("pos-1", "stop_hit")}     # pos-1 already alerted

    alerts, skipped = evaluate_position_conditions(
        _pos(id="pos-2"), current_price=93.0, existing=existing, today=TODAY,
    )

    assert [a["alert_type"] for a in alerts] == ["stop_hit"]
    assert alerts[0]["position_id"] == "pos-2"
    assert skipped == 0


# ---------------------------------------------------------------------------
# Trailing stop
# ---------------------------------------------------------------------------

def _mock_db():
    chains: dict[str, MagicMock] = {}

    def make_chain():
        chain = MagicMock()
        for method in ("select", "insert", "update", "delete", "eq", "in_", "order", "limit"):
            getattr(chain, method).return_value = chain
        result = MagicMock()
        result.data = [{"id": "x"}]
        chain.execute.return_value = result
        return chain

    db = MagicMock()
    db.table.side_effect = lambda name: chains.setdefault(name, make_chain())
    return db


TRAIL_CTX = MarketContext(
    symbol="AAPL",
    snapshot={"symbol": "AAPL", "atr_14": 3.0},
    bars=[
        {"symbol": "AAPL", "date": "2026-07-02", "high": 104.0, "low": 99.0,
         "open": 100.0, "close": 103.0, "volume": 1_000_000},
        {"symbol": "AAPL", "date": "2026-07-10", "high": 110.0, "low": 105.0,
         "open": 106.0, "close": 109.0, "volume": 1_000_000},
    ],
)


def test_trailing_stop_ratchets_up_and_persists():
    position = _pos(exit_plan={"trail_enabled": True, "trail_atr_mult": 3.0})
    db = _mock_db()

    with patch("app.services.position_monitor.get_client", return_value=db), \
         patch("app.services.positions.get_client", return_value=db), \
         patch("app.services.position_monitor.load_market_context", return_value=TRAIL_CTX):
        moved = apply_trailing_stop(position, current_price=109.0)

    # Highest high 110, ATR 3, 3x → 110 - 9 = 101, above the current stop of 94.
    assert moved == {"old_stop": 94.0, "new_stop": 101.0}
    assert db.table("positions").update.call_args[0][0]["stop_price"] == 101.0

    event = db.table("position_events").insert.call_args[0][0]
    assert event["event_type"]           == "stop_moved"
    assert event["payload"]["source"]    == "trailing_stop"
    assert event["payload"]["new_stop"]  == 101.0


def test_trailing_stop_never_ratchets_down():
    """
    The invariant. The position's stop has already trailed up to 105; the
    candidate from the current high is 101, which is worse. It must not move.
    """
    position = _pos(stop_price=105.0, exit_plan={"trail_enabled": True, "trail_atr_mult": 3.0})
    db = _mock_db()

    with patch("app.services.position_monitor.get_client", return_value=db), \
         patch("app.services.positions.get_client", return_value=db), \
         patch("app.services.position_monitor.load_market_context", return_value=TRAIL_CTX):
        moved = apply_trailing_stop(position, current_price=109.0)

    assert moved is None
    db.table("positions").update.assert_not_called()


def test_trailing_stop_is_a_no_op_when_disabled():
    db = _mock_db()

    with patch("app.services.position_monitor.get_client", return_value=db), \
         patch("app.services.position_monitor.load_market_context", return_value=TRAIL_CTX):
        assert apply_trailing_stop(_pos(exit_plan={"trail_enabled": False}), 109.0) is None

    db.table("positions").update.assert_not_called()


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def test_run_position_monitor_inserts_alerts_for_open_positions():
    db = _mock_db()

    with patch("app.services.position_monitor.get_client", return_value=db), \
         patch("app.services.position_monitor.pos_svc.get_open_positions", return_value=[_pos()]), \
         patch("app.services.position_monitor._get_existing_position_alerts_today", return_value=set()):
        summary = run_position_monitor({"AAPL": 112.50})

    assert summary["positions_monitored"] == 1
    assert summary["alerts_created"]      == 1

    inserted = db.table("alerts").insert.call_args[0][0]
    assert inserted[0]["alert_type"] == "target_hit"
    assert inserted[0]["category"]   == "position"


def test_run_position_monitor_skips_positions_with_no_quote():
    """A failed quote fetch shouldn't crash the cycle — the position waits."""
    db = _mock_db()

    with patch("app.services.position_monitor.get_client", return_value=db), \
         patch("app.services.position_monitor.pos_svc.get_open_positions", return_value=[_pos()]), \
         patch("app.services.position_monitor._get_existing_position_alerts_today", return_value=set()):
        summary = run_position_monitor({"MSFT": 400.0})   # no AAPL quote

    assert summary["positions_monitored"] == 0
    assert summary["alerts_created"]      == 0
    db.table("alerts").insert.assert_not_called()


def test_run_position_monitor_is_a_no_op_with_no_open_positions():
    db = _mock_db()

    with patch("app.services.position_monitor.get_client", return_value=db), \
         patch("app.services.position_monitor.pos_svc.get_open_positions", return_value=[]):
        summary = run_position_monitor({"AAPL": 112.0})

    assert summary["positions_monitored"] == 0
    assert summary["alerts_created"]      == 0


def test_monitor_does_not_auto_close_the_position():
    """
    Hitting a stop raises an alert; it does NOT close the trade. The app has no
    broker connection and cannot know the real fill price — inventing one would
    quietly corrupt the performance record.
    """
    db = _mock_db()

    with patch("app.services.position_monitor.get_client", return_value=db), \
         patch("app.services.position_monitor.pos_svc.get_open_positions", return_value=[_pos()]), \
         patch("app.services.position_monitor._get_existing_position_alerts_today", return_value=set()):
        run_position_monitor({"AAPL": 90.0})     # well through the stop

    # An alert was written, but the position row was never updated to 'closed'.
    db.table("alerts").insert.assert_called_once()
    db.table("positions").update.assert_not_called()
