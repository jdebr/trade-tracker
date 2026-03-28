"""
Indicator engine — computes all Tier 1 + Tier 2 indicators for a symbol
using data from ohlcv_cache.

Public API:
    compute_indicators(symbol) -> dict | None

Returns a dict ready to upsert into indicator_snapshots (most-recent bar only),
or None if there is insufficient history.

Indicators computed:
    Tier 1: RSI(14), MACD(12/26/9), BB(20/2), EMA ribbon (8/21/50)
            + bb_width and bb_squeeze flag
    Tier 2: ATR(14), OBV
"""

import logging
import math
import pandas as pd
import pandas_ta as ta
from app.services.ohlcv_cache import get_cached_bars

logger = logging.getLogger(__name__)

# Minimum bars needed to compute EMA-50 reliably.
MIN_BARS = 60

# Rolling window (trading days) used to evaluate bb_squeeze percentile.
BB_SQUEEZE_WINDOW = 252

# bb_squeeze fires when bb_width is at or below this percentile of the window.
BB_SQUEEZE_PERCENTILE = 20


def _to_dataframe(bars: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(bars)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").reset_index(drop=True)
    df = df.rename(columns={
        "open": "Open",
        "high": "High",
        "low": "Low",
        "close": "Close",
        "volume": "Volume",
    })
    df[["Open", "High", "Low", "Close", "Volume"]] = df[
        ["Open", "High", "Low", "Close", "Volume"]
    ].apply(pd.to_numeric)
    return df


def _safe(val) -> float | None:
    """Convert numpy/pandas scalars to Python float; return None for NaN."""
    if val is None:
        return None
    try:
        f = float(val)
        return None if math.isnan(f) else round(f, 6)
    except (TypeError, ValueError):
        return None


def compute_indicators(symbol: str) -> dict | None:
    """
    Load cached OHLCV for symbol, run all indicators, and return a dict
    representing the most-recent bar's snapshot.

    Returns None if there are fewer than MIN_BARS of history.
    """
    bars = get_cached_bars(symbol, limit=BB_SQUEEZE_WINDOW + 50)

    if len(bars) < MIN_BARS:
        logger.warning(
            "%s: only %d bars available (need %d) — skipping indicators",
            symbol, len(bars), MIN_BARS,
        )
        return None

    df = _to_dataframe(bars)

    # --- RSI(14) ---
    df.ta.rsi(length=14, append=True)

    # --- MACD(12/26/9) ---
    df.ta.macd(fast=12, slow=26, signal=9, append=True)

    # --- Bollinger Bands(20/2) ---
    df.ta.bbands(length=20, std=2, append=True)

    # --- EMA ribbon ---
    df.ta.ema(length=8, append=True)
    df.ta.ema(length=21, append=True)
    df.ta.ema(length=50, append=True)

    # --- ATR(14) ---
    df.ta.atr(length=14, append=True)

    # --- OBV ---
    df.ta.obv(append=True)

    # Derive bb_width = (upper - lower) / middle  (normalised bandwidth)
    bb_upper_col  = next((c for c in df.columns if c.startswith("BBU_")), None)
    bb_middle_col = next((c for c in df.columns if c.startswith("BBM_")), None)
    bb_lower_col  = next((c for c in df.columns if c.startswith("BBL_")), None)

    if bb_upper_col and bb_middle_col and bb_lower_col:
        df["bb_width"] = (df[bb_upper_col] - df[bb_lower_col]) / df[bb_middle_col]

        # bb_squeeze: True when current bb_width is at or below the 20th percentile
        # of its rolling window (up to 252 days).  Using pandas native rolling.quantile
        # avoids a slow Python lambda and handles NaN-filled early rows cleanly.
        rolling_20p = df["bb_width"].rolling(
            window=min(BB_SQUEEZE_WINDOW, len(df)), min_periods=20
        ).quantile(BB_SQUEEZE_PERCENTILE / 100)
        df["bb_squeeze"] = df["bb_width"] <= rolling_20p
    else:
        df["bb_width"] = None
        df["bb_squeeze"] = None

    # Pull the most-recent row
    last = df.iloc[-1]
    last_date = last["date"].date()

    # Resolve dynamic column names from pandas-ta
    macd_col   = next((c for c in df.columns if c.startswith("MACD_")), None)
    macds_col  = next((c for c in df.columns if c.startswith("MACDs_")), None)
    macdh_col  = next((c for c in df.columns if c.startswith("MACDh_")), None)
    ema8_col   = next((c for c in df.columns if c == "EMA_8"), None)
    ema21_col  = next((c for c in df.columns if c == "EMA_21"), None)
    ema50_col  = next((c for c in df.columns if c == "EMA_50"), None)
    atr_col    = next((c for c in df.columns if c.startswith("ATRr_") or c.startswith("ATR_")), None)
    obv_col    = next((c for c in df.columns if c.startswith("OBV")), None)
    rsi_col    = next((c for c in df.columns if c.startswith("RSI_")), None)

    bb_squeeze_val = last.get("bb_squeeze")
    if bb_squeeze_val is not None and not isinstance(bb_squeeze_val, bool):
        bb_squeeze_val = bool(bb_squeeze_val)

    obv_val = last[obv_col] if obv_col else None
    obv_int = int(obv_val) if obv_val is not None and not (isinstance(obv_val, float) and math.isnan(obv_val)) else None

    return {
        "symbol":      symbol.upper(),
        "date":        last_date.isoformat(),
        "rsi_14":      _safe(last[rsi_col])   if rsi_col   else None,
        "macd_line":   _safe(last[macd_col])  if macd_col  else None,
        "macd_signal": _safe(last[macds_col]) if macds_col else None,
        "macd_hist":   _safe(last[macdh_col]) if macdh_col else None,
        "bb_upper":    _safe(last[bb_upper_col])  if bb_upper_col  else None,
        "bb_middle":   _safe(last[bb_middle_col]) if bb_middle_col else None,
        "bb_lower":    _safe(last[bb_lower_col])  if bb_lower_col  else None,
        "bb_width":    _safe(last.get("bb_width")),
        "bb_squeeze":  bb_squeeze_val,
        "ema_8":       _safe(last[ema8_col])  if ema8_col  else None,
        "ema_21":      _safe(last[ema21_col]) if ema21_col else None,
        "ema_50":      _safe(last[ema50_col]) if ema50_col else None,
        "atr_14":      _safe(last[atr_col])   if atr_col   else None,
        "obv":         obv_int,
    }
