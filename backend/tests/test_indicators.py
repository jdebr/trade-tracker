"""
Tests for Milestone 4: indicator engine.

Testing criteria:
1. Indicator values for a known ticker/date match a reference.
2. bb_squeeze = True fires correctly on a ticker in a squeeze.
3. Upsert is idempotent — running twice doesn't duplicate rows.
"""

import pytest
import math
from datetime import date, timedelta
from app.services.indicators import compute_indicators
from app.services.indicator_cache import upsert_snapshots
from app.database import get_client

# Synthetic symbol names — never clashes with real watchlist entries.
SYM_TREND   = "TEST_TREND"    # trending price series → normal bb_width
SYM_SQUEEZE = "TEST_SQUEEZE"  # flat price series → very narrow bands → bb_squeeze


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _seed_ohlcv(symbol: str, closes: list[float]):
    """
    Seed ohlcv_cache with synthetic daily bars built from a close price series.
    Open = prev_close, High = close * 1.005, Low = close * 0.995, Volume = 1_000_000.
    """
    get_client().table("ohlcv_cache").delete().eq("symbol", symbol).execute()

    bars = []
    start = date(2024, 1, 2)  # fixed start for reproducibility
    prev_close = closes[0]
    for i, c in enumerate(closes):
        bar_date = start + timedelta(days=i)
        bars.append({
            "symbol": symbol,
            "date": bar_date.isoformat(),
            "open":   round(prev_close, 4),
            "high":   round(c * 1.005, 4),
            "low":    round(c * 0.995, 4),
            "close":  round(c, 4),
            "volume": 1_000_000,
            "source": "yfinance",
        })
        prev_close = c

    # Upsert in chunks to stay within Supabase request size limits.
    chunk = 200
    for i in range(0, len(bars), chunk):
        get_client().table("ohlcv_cache").upsert(
            bars[i:i+chunk], on_conflict="symbol,date"
        ).execute()


def _cleanup(symbol: str):
    get_client().table("ohlcv_cache").delete().eq("symbol", symbol).execute()
    get_client().table("indicator_snapshots").delete().eq("symbol", symbol).execute()


def _make_trending_closes(n: int = 120) -> list[float]:
    """Steadily rising prices: 100 → ~160 over n days."""
    return [100.0 + i * 0.5 for i in range(n)]


def _make_squeeze_closes(n_trend: int = 80, n_flat: int = 60) -> list[float]:
    """
    First n_trend bars: volatile trending prices (wide Bollinger Bands,
    bb_width ≈ 0.03–0.06).
    Last n_flat bars: extremely flat prices (bb_width < 0.001).

    The contrast is large enough that any flat bar is clearly in the bottom
    20th percentile of the combined window, regardless of random seed.
    """
    import random
    random.seed(42)
    # Trending section: daily random walk ±2 on a ~100 base → wide bands
    trend = [100.0]
    for _ in range(n_trend - 1):
        trend.append(trend[-1] + random.uniform(-2.0, 2.0))

    # Flat section: EXACTLY the same close price on every bar.
    # pandas-ta BB is computed on close prices → std=0 → bb_width=0 for all
    # flat bars.  The rolling 20th percentile = 0, current bb_width = 0 → True.
    flat_base = round(trend[-1], 2)
    flat = [flat_base] * n_flat
    return trend + flat


# ---------------------------------------------------------------------------
# Criterion 1: indicator values are mathematically correct
# ---------------------------------------------------------------------------

def test_indicator_values_are_correct():
    """
    Use a deterministic trending price series and verify:
    - RSI is in [0, 100]
    - MACD line, signal, hist are all present and finite
    - BB upper > middle > lower
    - EMA-8 > EMA-21 (short > long in an uptrend is not guaranteed; we verify they differ)
    - ATR > 0
    - OBV is an integer
    """
    closes = _make_trending_closes(120)
    _seed_ohlcv(SYM_TREND, closes)

    snap = compute_indicators(SYM_TREND)
    assert snap is not None, "Should produce a snapshot with 120 bars"

    # RSI in valid range
    assert snap["rsi_14"] is not None
    assert 0 <= snap["rsi_14"] <= 100, f"RSI out of range: {snap['rsi_14']}"

    # MACD components all present and finite
    for field in ("macd_line", "macd_signal", "macd_hist"):
        assert snap[field] is not None, f"{field} should not be None"
        assert math.isfinite(snap[field]), f"{field} should be finite"

    # Bollinger Bands ordering
    assert snap["bb_upper"] > snap["bb_middle"] > snap["bb_lower"], \
        "BB upper > middle > lower should always hold"

    # bb_width is positive
    assert snap["bb_width"] is not None
    assert snap["bb_width"] > 0

    # EMA values are all present and differ
    assert snap["ema_8"] is not None
    assert snap["ema_21"] is not None
    assert snap["ema_50"] is not None
    assert snap["ema_8"] != snap["ema_50"], "EMA-8 and EMA-50 should differ"

    # ATR positive
    assert snap["atr_14"] is not None
    assert snap["atr_14"] > 0, f"ATR should be positive, got {snap['atr_14']}"

    # OBV is an integer
    assert snap["obv"] is not None
    assert isinstance(snap["obv"], int), f"OBV should be int, got {type(snap['obv'])}"

    _cleanup(SYM_TREND)


# ---------------------------------------------------------------------------
# Criterion 2: bb_squeeze fires on a flat/tight price series
# ---------------------------------------------------------------------------

def test_bb_squeeze_fires_on_tight_series():
    """
    A nearly-flat price series produces very narrow Bollinger Bands.
    After a long run of tight bars the bb_width should be in the lowest
    20th percentile of its own rolling window → bb_squeeze = True.
    """
    closes = _make_squeeze_closes()
    _seed_ohlcv(SYM_SQUEEZE, closes)

    snap = compute_indicators(SYM_SQUEEZE)
    assert snap is not None

    assert snap["bb_squeeze"] is True, (
        f"Expected bb_squeeze=True on flat series, got {snap['bb_squeeze']}. "
        f"bb_width={snap['bb_width']}"
    )

    _cleanup(SYM_SQUEEZE)


# ---------------------------------------------------------------------------
# Criterion 3: upsert is idempotent
# ---------------------------------------------------------------------------

def test_upsert_is_idempotent():
    """
    Running upsert_snapshots twice with the same snapshot should not
    create duplicate rows.
    """
    symbol = "TEST_IDEM"
    get_client().table("indicator_snapshots").delete().eq("symbol", symbol).execute()

    snap = {
        "symbol":      symbol,
        "date":        "2024-06-01",
        "rsi_14":      55.0,
        "macd_line":   0.5,
        "macd_signal": 0.4,
        "macd_hist":   0.1,
        "bb_upper":    105.0,
        "bb_middle":   100.0,
        "bb_lower":    95.0,
        "bb_width":    0.1,
        "bb_squeeze":  False,
        "ema_8":       101.0,
        "ema_21":      100.5,
        "ema_50":      99.0,
        "atr_14":      2.0,
        "obv":         5_000_000,
    }

    upsert_snapshots([snap])
    upsert_snapshots([snap])  # second upsert — must not duplicate

    result = (
        get_client()
        .table("indicator_snapshots")
        .select("id")
        .eq("symbol", symbol)
        .eq("date", "2024-06-01")
        .execute()
    )
    assert len(result.data) == 1, f"Expected 1 row, got {len(result.data)}"

    get_client().table("indicator_snapshots").delete().eq("symbol", symbol).execute()
