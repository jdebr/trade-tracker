"""
Tests for the feature context assembly.

Correctness metrics codified here:
  - the registry and the assembler never drift: every VARIABLE_NAME is produced by
    build_feature_context and nothing extra is (the invariant M20/M22 must keep)
  - snapshot fields map through with correct types (bb_squeeze -> bool, rest -> float)
  - close / vol_3d / vol_20d derive from the trailing bars exactly like the screener
  - missing snapshot / empty bars degrade to None (never crash), so the null-safe
    engine can do its job
"""

from unittest.mock import patch

from app.services import feature_context as fc
from app.services.feature_context import (
    VARIABLE_NAMES,
    _assemble,
    build_feature_context,
    build_feature_contexts,
)

FULL_SNAPSHOT = {
    "symbol": "AAPL", "date": "2026-07-10",
    "rsi_14": 30.0, "macd_line": 1.0, "macd_signal": 0.5, "macd_hist": 0.5,
    "bb_upper": 110.0, "bb_middle": 100.0, "bb_lower": 90.0, "bb_width": 0.2,
    "bb_squeeze": True,
    "ema_8": 101.0, "ema_21": 99.0, "ema_50": 95.0,
    "atr_14": 3.0, "obv": 1_000_000,
}

# 20 bars, oldest -> newest. Volumes ramp so the 3d and 20d averages differ.
BARS = [
    {"close": 100.0 + i, "volume": 1_000 * (i + 1)}
    for i in range(20)
]


# ---------------------------------------------------------------------------
# The registry <-> assembler invariant
# ---------------------------------------------------------------------------

def test_context_keys_exactly_match_registry():
    ctx = _assemble(FULL_SNAPSHOT, BARS)
    assert set(ctx.keys()) == set(VARIABLE_NAMES)


# ---------------------------------------------------------------------------
# Field mapping + types
# ---------------------------------------------------------------------------

def test_snapshot_fields_map_with_correct_types():
    ctx = _assemble(FULL_SNAPSHOT, BARS)
    assert ctx["rsi_14"] == 30.0 and isinstance(ctx["rsi_14"], float)
    assert ctx["obv"] == 1_000_000.0 and isinstance(ctx["obv"], float)
    assert ctx["bb_squeeze"] is True  # coerced to bool, not 1.0


def test_derived_price_and_volume():
    ctx = _assemble(FULL_SNAPSHOT, BARS)
    assert ctx["close"] == 119.0                      # newest bar close (100 + 19)
    # vol_20d = mean(1000..20000) = 10500 ; vol_3d = mean(18000,19000,20000) = 19000
    assert ctx["vol_20d"] == 10_500.0
    assert ctx["vol_3d"] == 19_000.0


# ---------------------------------------------------------------------------
# Degradation to None
# ---------------------------------------------------------------------------

def test_missing_snapshot_yields_all_none_indicators():
    ctx = _assemble({}, BARS)
    assert ctx["rsi_14"] is None
    assert ctx["bb_squeeze"] is None
    # price/volume still derive from bars
    assert ctx["close"] == 119.0


def test_empty_bars_yield_none_price_and_volume():
    ctx = _assemble(FULL_SNAPSHOT, [])
    assert ctx["close"] is None
    assert ctx["vol_3d"] is None
    assert ctx["vol_20d"] is None


def test_short_history_still_averages_available_bars():
    ctx = _assemble(FULL_SNAPSHOT, BARS[:2])  # only 2 bars
    assert ctx["close"] == 101.0
    assert ctx["vol_20d"] == 1_500.0          # mean(1000, 2000)
    assert ctx["vol_3d"] == 1_500.0           # min(3, 2) -> mean of both


def test_volume_window_caps_at_20_bars_even_when_more_supplied():
    # MarketContext loads 60 bars; vol_20d must still be a 20-day average, not
    # diluted by the older 40 bars. Newest 20 bars all have volume 5000.
    bars = [{"close": 100.0 + i, "volume": 1_000 if i < 40 else 5_000} for i in range(60)]
    ctx = _assemble(FULL_SNAPSHOT, bars)
    assert ctx["close"] == 159.0        # newest bar (100 + 59)
    assert ctx["vol_20d"] == 5_000.0    # last 20 only, not averaged with the 1_000s


# ---------------------------------------------------------------------------
# build_feature_context (single + batched)
# ---------------------------------------------------------------------------

def test_build_feature_context_single():
    with patch.object(fc, "get_latest_snapshots", return_value=[FULL_SNAPSHOT]), \
         patch.object(fc, "get_cached_bars", return_value=BARS):
        ctx = build_feature_context("aapl")
    assert ctx["rsi_14"] == 30.0
    assert ctx["close"] == 119.0


def test_build_feature_context_no_data():
    with patch.object(fc, "get_latest_snapshots", return_value=[]), \
         patch.object(fc, "get_cached_bars", return_value=[]):
        ctx = build_feature_context("zzz")
    assert set(ctx.keys()) == set(VARIABLE_NAMES)
    assert all(v is None for v in ctx.values())


def _summary(close, vol_3d, vol_avg):
    return {"last_date": "2026-07-03", "last_close": close, "bar_count": 20,
            "vol_3d": vol_3d, "vol_avg": vol_avg, "last_fetched_at": None}


def test_build_feature_contexts_batched():
    snaps = [dict(FULL_SNAPSHOT, symbol="AAPL"), dict(FULL_SNAPSHOT, symbol="MSFT", rsi_14=60.0)]
    summary = {"AAPL": _summary(119.0, 3e6, 2e6), "MSFT": _summary(104.0, 1e6, 1.5e6)}
    with patch.object(fc, "get_latest_snapshots", return_value=snaps),          patch.object(fc, "get_ohlcv_summary", return_value=summary) as summ:
        contexts = build_feature_contexts(["aapl", "msft"])
    summ.assert_called_once_with(["AAPL", "MSFT"], window=fc._VOL_WINDOW)
    assert set(contexts.keys()) == {"AAPL", "MSFT"}
    assert contexts["AAPL"]["rsi_14"] == 30.0
    assert contexts["MSFT"]["rsi_14"] == 60.0
    assert contexts["MSFT"]["close"] == 104.0
    assert contexts["AAPL"]["vol_3d"] == 3e6
    assert contexts["AAPL"]["vol_20d"] == 2e6


def test_build_feature_contexts_symbol_without_bars():
    with patch.object(fc, "get_latest_snapshots", return_value=[dict(FULL_SNAPSHOT, symbol="AAPL")]),          patch.object(fc, "get_ohlcv_summary", return_value={}):
        ctx = build_feature_contexts(["AAPL"])["AAPL"]
    assert ctx["rsi_14"] == 30.0
    assert ctx["close"] is None and ctx["vol_20d"] is None


def test_build_feature_contexts_drops_stale_snapshots_only_when_asked():
    from datetime import date, timedelta
    old = (date.today() - timedelta(days=30)).isoformat()
    new = date.today().isoformat()
    snaps = [dict(FULL_SNAPSHOT, symbol="OLD", date=old), dict(FULL_SNAPSHOT, symbol="NEW", date=new)]
    with patch.object(fc, "get_latest_snapshots", return_value=snaps),          patch.object(fc, "get_ohlcv_summary", return_value={}):
        strict = build_feature_contexts(["OLD", "NEW"], max_snapshot_age_days=10)
        lenient = build_feature_contexts(["OLD", "NEW"])
    assert not fc.snapshot_present(strict["OLD"])
    assert fc.snapshot_present(strict["NEW"])
    assert fc.snapshot_present(lenient["OLD"])


def test_build_feature_contexts_empty():
    assert build_feature_contexts([]) == {}
