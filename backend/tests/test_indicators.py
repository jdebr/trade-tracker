"""
Tests for the indicator engine (app/services/indicators.py).

get_cached_bars is mocked so no real Supabase connection is required.
The actual pandas-ta math still runs against synthetic price series,
so the tests validate real indicator correctness — not just wiring.

Criteria:
1. Indicator values are mathematically valid for a trending series
2. bb_squeeze fires on a flat/tight price series
3. compute_indicators returns None when there are fewer than MIN_BARS
4. upsert_snapshots calls DB with the correct rows; idempotency is a DB
   constraint (UNIQUE on symbol,date) — we verify the upsert is called once
   per invocation, not that the DB deduplicates (that's Supabase's job)
"""

import math
import random
from datetime import date, timedelta
from unittest.mock import MagicMock, patch, call
import pytest

from app.services.indicators import compute_indicators
from app.services.indicator_cache import upsert_snapshots


# ---------------------------------------------------------------------------
# Helpers — synthetic OHLCV bars (no DB needed)
# ---------------------------------------------------------------------------

def _make_bars(closes: list[float]) -> list[dict]:
    """Build synthetic OHLCV bar dicts from a close price series."""
    bars = []
    start = date(2024, 1, 2)
    prev = closes[0]
    for i, c in enumerate(closes):
        bars.append({
            "symbol": "TEST",
            "date":   (start + timedelta(days=i)).isoformat(),
            "open":   round(prev, 4),
            "high":   round(c * 1.005, 4),
            "low":    round(c * 0.995, 4),
            "close":  round(c, 4),
            "volume": 1_000_000,
            "source": "yfinance",
        })
        prev = c
    return bars


def _trending_closes(n: int = 120) -> list[float]:
    """Steadily rising prices: 100 → ~160 over n days."""
    return [100.0 + i * 0.5 for i in range(n)]


def _squeeze_closes(n_trend: int = 80, n_flat: int = 60) -> list[float]:
    """
    Volatile trending section followed by a dead-flat section.
    The flat section produces bb_width ≈ 0 → well below 20th percentile.
    """
    random.seed(42)
    trend = [100.0]
    for _ in range(n_trend - 1):
        trend.append(trend[-1] + random.uniform(-2.0, 2.0))
    flat_base = round(trend[-1], 2)
    return trend + [flat_base] * n_flat


# ---------------------------------------------------------------------------
# 1. Indicator values are mathematically valid
# ---------------------------------------------------------------------------

def test_indicator_values_are_correct():
    bars = _make_bars(_trending_closes(120))

    with patch("app.services.indicators.get_cached_bars", return_value=bars):
        snap = compute_indicators("TEST")

    assert snap is not None, "Should produce a snapshot with 120 bars"

    assert snap["rsi_14"] is not None
    assert 0 <= snap["rsi_14"] <= 100, f"RSI out of range: {snap['rsi_14']}"

    for field in ("macd_line", "macd_signal", "macd_hist"):
        assert snap[field] is not None, f"{field} should not be None"
        assert math.isfinite(snap[field]), f"{field} should be finite"

    assert snap["bb_upper"] > snap["bb_middle"] > snap["bb_lower"], \
        "BB ordering: upper > middle > lower must hold"

    assert snap["bb_width"] is not None and snap["bb_width"] > 0

    for ema in ("ema_8", "ema_21", "ema_50"):
        assert snap[ema] is not None, f"{ema} should not be None"
    assert snap["ema_8"] != snap["ema_50"], "EMA-8 and EMA-50 should differ"

    assert snap["atr_14"] is not None and snap["atr_14"] > 0
    assert snap["obv"] is not None and isinstance(snap["obv"], int)


# ---------------------------------------------------------------------------
# 2. bb_squeeze fires on a flat price series
# ---------------------------------------------------------------------------

def test_bb_squeeze_fires_on_tight_series():
    bars = _make_bars(_squeeze_closes())

    with patch("app.services.indicators.get_cached_bars", return_value=bars):
        snap = compute_indicators("TEST")

    assert snap is not None
    assert snap["bb_squeeze"] is True, (
        f"Expected bb_squeeze=True on flat series, "
        f"got {snap['bb_squeeze']} (bb_width={snap['bb_width']})"
    )


# ---------------------------------------------------------------------------
# 3. Returns None when insufficient bars
# ---------------------------------------------------------------------------

def test_compute_indicators_returns_none_for_insufficient_bars():
    bars = _make_bars(_trending_closes(30))  # only 30 bars, need 60

    with patch("app.services.indicators.get_cached_bars", return_value=bars):
        snap = compute_indicators("TEST")

    assert snap is None


# ---------------------------------------------------------------------------
# 4. upsert_snapshots passes the correct rows to the DB client
# ---------------------------------------------------------------------------

def test_upsert_snapshots_calls_db_with_correct_rows():
    snap = {
        "symbol": "TEST_IDEM", "date": "2024-06-01",
        "rsi_14": 55.0, "macd_line": 0.5, "macd_signal": 0.4, "macd_hist": 0.1,
        "bb_upper": 105.0, "bb_middle": 100.0, "bb_lower": 95.0,
        "bb_width": 0.1, "bb_squeeze": False,
        "ema_8": 101.0, "ema_21": 100.5, "ema_50": 99.0,
        "atr_14": 2.0, "obv": 5_000_000,
    }

    mock_client = MagicMock()
    mock_client.table.return_value.upsert.return_value.execute.return_value.data = [snap]

    with patch("app.services.indicator_cache.get_client", return_value=mock_client):
        count = upsert_snapshots([snap])

    assert count == 1
    mock_client.table.return_value.upsert.assert_called_once_with(
        [snap], on_conflict="symbol,date"
    )
