"""
Tests for Milestone 7 scanner — alert condition evaluation.

Criteria:
1.  No alerts when all conditions are neutral / unmet
2.  bb_squeeze fires when bb_squeeze=True
3.  rsi_oversold fires when rsi_14 < 30
4.  rsi_overbought fires when rsi_14 > 70
5.  macd_crossover fires when hist flips ≤0 → >0
6.  macd_crossover does NOT fire without a prior snapshot
7.  macd_crossover does NOT fire when hist stays positive
8.  ema_crossover fires when ema_8 crosses above ema_21
9.  ema_crossover does NOT fire without a prior snapshot
10. ema_crossover does NOT fire when already above (no crossover)
11. vol_expansion fires when 3-day avg > 20-day avg
12. vol_expansion does NOT fire when 3-day avg ≤ 20-day avg
13. Dedup: condition that already exists in `existing` is skipped
14. Multiple conditions can fire in the same run
15. Alert dict has all required fields and acknowledged=False
"""

from datetime import date
from unittest.mock import MagicMock, patch

from app.services.scanner import _evaluate_conditions, run_watchlist_scan

TODAY = date(2026, 3, 29)
NO_EXISTING: set[tuple[str, str]] = set()

# Market data helpers
_EXPANDING  = {"vol_3d": 2_000_000, "vol_20d": 1_000_000, "last_close": 150.0}
_FLAT       = {"vol_3d":   800_000, "vol_20d": 1_000_000, "last_close": 150.0}
_NO_MARKET  = None


def _snap(
    symbol    = "AAPL",
    rsi       = 50.0,
    bb_squeeze = False,
    bb_width  = 0.10,
    macd_hist = 0.5,
    ema_8     = 150.0,
    ema_21    = 145.0,
) -> dict:
    return {
        "symbol":    symbol,
        "rsi_14":    rsi,
        "bb_squeeze": bb_squeeze,
        "bb_width":  bb_width,
        "macd_hist": macd_hist,
        "ema_8":     ema_8,
        "ema_21":    ema_21,
    }


def _prior(macd_hist=0.1, ema_8=144.0, ema_21=145.0) -> dict:
    return {"macd_hist": macd_hist, "ema_8": ema_8, "ema_21": ema_21}


def _types(alerts: list[dict]) -> set[str]:
    return {a["alert_type"] for a in alerts}


# ---------------------------------------------------------------------------
# 1. Neutral — no alerts
# ---------------------------------------------------------------------------

def test_no_alerts_neutral():
    alerts, skipped = _evaluate_conditions(
        snap=_snap(rsi=50.0, bb_squeeze=False, macd_hist=0.1),
        prior=_prior(macd_hist=0.05, ema_8=150.0, ema_21=145.0),
        market_data=_FLAT,
        existing=NO_EXISTING,
        today=TODAY,
    )
    assert alerts == []
    assert skipped == 0


# ---------------------------------------------------------------------------
# 2–4. Individual condition fires
# ---------------------------------------------------------------------------

def test_bb_squeeze_fires():
    alerts, _ = _evaluate_conditions(
        snap=_snap(bb_squeeze=True),
        prior=None,
        market_data=_FLAT,
        existing=NO_EXISTING,
        today=TODAY,
    )
    assert "bb_squeeze" in _types(alerts)


def test_rsi_oversold_fires():
    alerts, _ = _evaluate_conditions(
        snap=_snap(rsi=28.5),
        prior=None,
        market_data=_FLAT,
        existing=NO_EXISTING,
        today=TODAY,
    )
    assert "rsi_oversold" in _types(alerts)


def test_rsi_overbought_fires():
    alerts, _ = _evaluate_conditions(
        snap=_snap(rsi=71.0),
        prior=None,
        market_data=_FLAT,
        existing=NO_EXISTING,
        today=TODAY,
    )
    assert "rsi_overbought" in _types(alerts)


# ---------------------------------------------------------------------------
# 5–7. MACD crossover
# ---------------------------------------------------------------------------

def test_macd_crossover_fires():
    alerts, _ = _evaluate_conditions(
        snap=_snap(macd_hist=0.3),
        prior=_prior(macd_hist=-0.1),
        market_data=_FLAT,
        existing=NO_EXISTING,
        today=TODAY,
    )
    assert "macd_crossover" in _types(alerts)


def test_macd_crossover_requires_prior():
    alerts, _ = _evaluate_conditions(
        snap=_snap(macd_hist=0.3),
        prior=None,
        market_data=_FLAT,
        existing=NO_EXISTING,
        today=TODAY,
    )
    assert "macd_crossover" not in _types(alerts)


def test_macd_crossover_no_fire_when_stays_positive():
    alerts, _ = _evaluate_conditions(
        snap=_snap(macd_hist=0.5),
        prior=_prior(macd_hist=0.2),   # was already positive
        market_data=_FLAT,
        existing=NO_EXISTING,
        today=TODAY,
    )
    assert "macd_crossover" not in _types(alerts)


# ---------------------------------------------------------------------------
# 8–10. EMA crossover
# ---------------------------------------------------------------------------

def test_ema_crossover_fires():
    # ema_8 crosses above ema_21
    alerts, _ = _evaluate_conditions(
        snap=_snap(ema_8=146.0, ema_21=145.0),      # now above
        prior=_prior(ema_8=144.0, ema_21=145.0),    # was below
        market_data=_FLAT,
        existing=NO_EXISTING,
        today=TODAY,
    )
    assert "ema_crossover" in _types(alerts)


def test_ema_crossover_requires_prior():
    alerts, _ = _evaluate_conditions(
        snap=_snap(ema_8=146.0, ema_21=145.0),
        prior=None,
        market_data=_FLAT,
        existing=NO_EXISTING,
        today=TODAY,
    )
    assert "ema_crossover" not in _types(alerts)


def test_ema_crossover_no_fire_when_already_above():
    # ema_8 was already above ema_21 — not a new crossover
    alerts, _ = _evaluate_conditions(
        snap=_snap(ema_8=148.0, ema_21=145.0),
        prior=_prior(ema_8=147.0, ema_21=145.0),   # already above
        market_data=_FLAT,
        existing=NO_EXISTING,
        today=TODAY,
    )
    assert "ema_crossover" not in _types(alerts)


# ---------------------------------------------------------------------------
# 11–12. Volume expansion
# ---------------------------------------------------------------------------

def test_vol_expansion_fires():
    alerts, _ = _evaluate_conditions(
        snap=_snap(),
        prior=None,
        market_data=_EXPANDING,
        existing=NO_EXISTING,
        today=TODAY,
    )
    assert "vol_expansion" in _types(alerts)


def test_vol_expansion_no_fire_when_flat():
    alerts, _ = _evaluate_conditions(
        snap=_snap(),
        prior=None,
        market_data=_FLAT,
        existing=NO_EXISTING,
        today=TODAY,
    )
    assert "vol_expansion" not in _types(alerts)


# ---------------------------------------------------------------------------
# 13. Dedup
# ---------------------------------------------------------------------------

def test_dedup_skips_existing_alert():
    existing = {("AAPL", "bb_squeeze")}
    alerts, skipped = _evaluate_conditions(
        snap=_snap(bb_squeeze=True),
        prior=None,
        market_data=_FLAT,
        existing=existing,
        today=TODAY,
    )
    assert "bb_squeeze" not in _types(alerts)
    assert skipped == 1


def test_dedup_does_not_block_other_types():
    existing = {("AAPL", "bb_squeeze")}
    alerts, skipped = _evaluate_conditions(
        snap=_snap(bb_squeeze=True, rsi=25.0),
        prior=None,
        market_data=_FLAT,
        existing=existing,
        today=TODAY,
    )
    assert "bb_squeeze" not in _types(alerts)
    assert "rsi_oversold" in _types(alerts)
    assert skipped == 1


# ---------------------------------------------------------------------------
# 14. Multiple conditions
# ---------------------------------------------------------------------------

def test_multiple_conditions_fire_together():
    alerts, _ = _evaluate_conditions(
        snap=_snap(bb_squeeze=True, rsi=25.0, macd_hist=0.3),
        prior=_prior(macd_hist=-0.1, ema_8=144.0, ema_21=145.0),
        market_data=_EXPANDING,
        existing=NO_EXISTING,
        today=TODAY,
    )
    types = _types(alerts)
    assert "bb_squeeze"    in types
    assert "rsi_oversold"  in types
    assert "macd_crossover" in types
    assert "vol_expansion" in types


# ---------------------------------------------------------------------------
# 15. Alert structure
# ---------------------------------------------------------------------------

def test_alert_has_required_fields():
    alerts, _ = _evaluate_conditions(
        snap=_snap(rsi=25.0),
        prior=None,
        market_data=_FLAT,
        existing=NO_EXISTING,
        today=TODAY,
    )
    assert len(alerts) >= 1
    for alert in alerts:
        assert alert["symbol"]     == "AAPL"
        assert alert["date"]       == TODAY.isoformat()
        assert "alert_type"        in alert
        assert alert["acknowledged"] is False
        assert "details"           in alert


def test_alert_price_at_trigger_set_from_market_data():
    alerts, _ = _evaluate_conditions(
        snap=_snap(rsi=25.0),
        prior=None,
        market_data={"vol_3d": 500_000, "vol_20d": 1_000_000, "last_close": 175.50},
        existing=NO_EXISTING,
        today=TODAY,
    )
    for alert in alerts:
        assert alert["price_at_trigger"] == 175.50


# ---------------------------------------------------------------------------
# 16–18. run_watchlist_scan orchestration
#
# The EOD scan refreshes data for the union of watchlist symbols and open-position
# symbols, but evaluates opportunity conditions for the watchlist only. Position
# conditions run afterwards, against the day's closes.
# ---------------------------------------------------------------------------

def _scan_stack(watchlist, position_symbols, monitor_mock=None):
    """Patch every collaborator of run_watchlist_scan. Returns a list of patchers."""
    monitor_mock = monitor_mock or MagicMock(return_value={
        "positions_monitored": 0, "alerts_created": 0, "stops_trailed": 0,
    })
    return [
        patch("app.services.scanner._get_watchlist_symbols", return_value=watchlist),
        patch("app.services.scanner.pos_svc.get_open_position_symbols", return_value=position_symbols),
        patch("app.services.scanner._fetch_ohlcv_for_symbols"),
        patch("app.services.scanner._get_prior_snapshots", return_value={}),
        patch("app.services.scanner._get_existing_alerts_today", return_value=set()),
        patch("app.services.scanner.run_position_monitor", monitor_mock),
        patch("app.services.scanner.get_client", return_value=MagicMock()),
    ], monitor_mock


def test_scan_refreshes_indicators_for_position_symbols_off_the_watchlist():
    """
    A position can be held in a name that is no longer on the watchlist. Its ATR
    still has to be recomputed each day or the trailing stop has stale data to
    work from — so the OHLCV/indicator refresh must cover the union.
    """
    compute_mock = MagicMock(return_value=[])
    patches, _ = _scan_stack(watchlist=["AAPL"], position_symbols=["TSLA"])

    with patch("app.services.scanner._compute_indicators_for_symbols", compute_mock):
        for p in patches:
            p.start()
        try:
            result = run_watchlist_scan()
        finally:
            for p in patches:
                p.stop()

    assert result.symbols_scanned == 2
    assert compute_mock.call_args[0][0] == ["AAPL", "TSLA"]


def test_scan_evaluates_opportunity_conditions_for_watchlist_symbols_only():
    """
    You're already in TSLA — "here's a trade idea" alerts on it would be noise.
    Only watchlist symbols get opportunity conditions.
    """
    snapshots = [
        {**_snap(symbol="AAPL", rsi=25.0), "symbol": "AAPL"},
        {**_snap(symbol="TSLA", rsi=25.0), "symbol": "TSLA"},
    ]
    market = {
        "AAPL": {"vol_3d": 1, "vol_20d": 2, "last_close": 150.0},
        "TSLA": {"vol_3d": 1, "vol_20d": 2, "last_close": 250.0},
    }
    patches, _ = _scan_stack(watchlist=["AAPL"], position_symbols=["TSLA"])

    with patch("app.services.scanner._compute_indicators_for_symbols", return_value=snapshots), \
         patch("app.services.scanner._get_market_data", return_value=market):
        for p in patches:
            p.start()
        try:
            result = run_watchlist_scan()
        finally:
            for p in patches:
                p.stop()

    # Both are deeply oversold, but only AAPL is on the watchlist.
    assert result.alerts_created == 1


def test_scan_hands_closing_prices_to_the_position_monitor():
    snapshots = [{**_snap(symbol="TSLA"), "symbol": "TSLA"}]
    market    = {"TSLA": {"vol_3d": 1, "vol_20d": 2, "last_close": 250.0}}

    monitor_mock = MagicMock(return_value={
        "positions_monitored": 1, "alerts_created": 1, "stops_trailed": 1,
    })
    patches, _ = _scan_stack(watchlist=[], position_symbols=["TSLA"], monitor_mock=monitor_mock)

    with patch("app.services.scanner._compute_indicators_for_symbols", return_value=snapshots), \
         patch("app.services.scanner._get_market_data", return_value=market):
        for p in patches:
            p.start()
        try:
            result = run_watchlist_scan()
        finally:
            for p in patches:
                p.stop()

    assert monitor_mock.call_args[0][0] == {"TSLA": 250.0}
    assert result.positions_monitored     == 1
    assert result.position_alerts_created == 1
    assert result.stops_trailed           == 1
