"""
Tests for candlestick pattern recognition (app/services/candlesticks.py).

Real TA-Lib runs against hand-made OHLC fixtures: a ~20-bar trend of ordinary
candles (TA-Lib judges body/shadow size against recent candles) followed by
the pattern bar.
"""

from unittest.mock import patch

import pandas as pd

from app.services import candlesticks as cs
from app.services.candlesticks import (
    PATTERN_VARIABLES, PATTERN_VARIABLE_NAMES, RECENT_BARS, compute_patterns,
)


def _frame(rows):
    return pd.DataFrame(rows, columns=["Open", "High", "Low", "Close"])


def _down(n=20, start=120.0):
    rows, p = [], start
    for _ in range(n):
        rows.append([p, p + 0.3, p - 1.3, p - 1.0])
        p -= 1.0
    return rows


def _up(n=20, start=80.0):
    rows, p = [], start
    for _ in range(n):
        rows.append([p, p + 1.3, p - 0.3, p + 1.0])
        p += 1.0
    return rows


def _hammer_after(rows):
    last = rows[-1][3]
    return rows + [[last - 0.2, last + 0.05, last - 3.5, last + 0.1]]


# ---------------------------------------------------------------------------
# Variables
# ---------------------------------------------------------------------------

def test_curated_set_yields_20_latest_and_40_total_variables():
    assert len(cs.CURATED_PATTERNS) == 17
    assert len(PATTERN_VARIABLES) == 20
    assert len(PATTERN_VARIABLE_NAMES) == 40
    assert {"cdl_hammer", "cdl_hammer_5d", "cdl_engulfing_bull", "cdl_engulfing_bear_5d"} <= PATTERN_VARIABLE_NAMES


def test_every_variable_has_label_direction_and_meaning():
    for v in PATTERN_VARIABLES:
        assert v["name"].startswith("cdl_")
        assert v["label"] and v["meaning"]
        assert v["direction"] in {"bullish", "bearish", "neutral"}


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------

def test_hammer_after_decline():
    out = compute_patterns(_frame(_hammer_after(_down())))
    assert out["cdl_hammer"] is True
    assert out["cdl_hammer_5d"] is True


def test_engulfing_splits_by_direction():
    d = _down(); last = d[-1][3]
    bull = compute_patterns(_frame(d + [[last - 0.5, last + 2.2, last - 0.6, last + 2.0]]))
    assert bull.get("cdl_engulfing_bull") and "cdl_engulfing_bear" not in bull

    u = _up(); last = u[-1][3]
    bear = compute_patterns(_frame(u + [[last + 0.5, last + 0.6, last - 2.2, last - 2.0]]))
    assert bear.get("cdl_engulfing_bear") and "cdl_engulfing_bull" not in bear


def test_doji():
    d = _down(); last = d[-1][3]
    out = compute_patterns(_frame(d + [[last, last + 1.0, last - 1.0, last + 0.01]]))
    assert out["cdl_doji"] is True


def test_ordinary_candles_fire_nothing_and_result_is_sparse():
    out = compute_patterns(_frame(_down(25)))
    assert out == {}


def test_short_history_returns_empty():
    assert compute_patterns(_frame(_down(cs.MIN_PATTERN_BARS - 1))) == {}


# ---------------------------------------------------------------------------
# Recency window
# ---------------------------------------------------------------------------

def _plain_after(rows, n):
    """n ordinary down candles continuing from the last close."""
    p = rows[-1][3]
    return rows + [[q, q + 0.3, q - 1.3, q - 1.0] for q in (p - i for i in range(n))]


def test_recent_variant_holds_for_window_then_expires():
    base = _hammer_after(_down())
    within = compute_patterns(_frame(_plain_after(base, RECENT_BARS - 1)))
    assert "cdl_hammer" not in within               # no longer the latest bar
    assert within.get("cdl_hammer_5d") is True      # still within the window

    past = compute_patterns(_frame(_plain_after(base, RECENT_BARS)))
    assert "cdl_hammer_5d" not in past


# ---------------------------------------------------------------------------
# compute_indicators writes the sparse flags to `extra`
# ---------------------------------------------------------------------------

def test_compute_indicators_includes_extra():
    from app.services.indicators import compute_indicators
    rows = _hammer_after(_down(80, start=200.0))
    bars = [
        {"symbol": "T", "date": f"2026-{1 + i // 28:02d}-{1 + i % 28:02d}", "open": o, "high": h,
         "low": l, "close": c, "volume": 1_000_000}
        for i, (o, h, l, c) in enumerate(rows)
    ]
    with patch("app.services.indicators.get_cached_bars", return_value=bars):
        snap = compute_indicators("T")
    assert snap["extra"].get("cdl_hammer") is True
    assert all(v is True for v in snap["extra"].values())


# ---------------------------------------------------------------------------
# Engine exposure (feature context + rules)
# ---------------------------------------------------------------------------

from app.services import feature_context as fc
from app.services.rule_engine import evaluate
from app.services.signal_rules import evaluate_signals, validate_expression


def test_registry_has_both_candlestick_groups():
    groups = {}
    for e in fc.VARIABLE_REGISTRY:
        if e["name"].startswith("cdl_"):
            groups.setdefault(e["group"], []).append(e)
    assert {g: len(v) for g, v in groups.items()} == {
        "candlesticks · latest bar": 20, f"candlesticks · last {RECENT_BARS} bars": 20,
    }
    assert all(e["type"] == "boolean" for v in groups.values() for e in v)
    assert fc.VARIABLE_LABELS["cdl_hammer_5d"] == f"Hammer (last {RECENT_BARS} bars)"


def test_computed_extra_fills_missing_patterns_false():
    ctx = fc._assemble({"rsi_14": 50, "extra": {"cdl_hammer": True}}, [])
    assert ctx["cdl_hammer"] is True
    assert ctx["cdl_doji"] is False and ctx["cdl_hammer_5d"] is False


def test_uncomputed_extra_gives_none_so_rules_dont_fire():
    ctx = fc._assemble({"rsi_14": 50, "extra": None}, [])
    assert ctx["cdl_hammer"] is None
    assert evaluate({"var": "cdl_hammer"}, ctx) is False           # "is true"
    assert evaluate({"!": [{"var": "cdl_hammer"}]}, ctx) is False  # "is false" — unknown, not true


def test_pattern_rule_validates_and_scores():
    rule = {"and": [{"var": "cdl_engulfing_bull_5d"}, {"<": [{"var": "rsi_14"}, 40]}]}
    assert validate_expression(rule) == []
    features = fc._assemble({"rsi_14": 35, "extra": {"cdl_engulfing_bull_5d": True}}, [])
    res = evaluate_signals(features, [{"slug": "bull_engulf", "weight": 2, "expression": rule}])
    assert res["signals"]["bull_engulf"] is True
    assert res["signal_score"] == 2
