"""
Market data fetching: Twelve Data (primary) + yfinance (fallback).

Both providers expose the same interface:
    fetch_ohlcv(symbol, lookback_days) -> list[dict]

Each dict has keys: symbol, date, open, high, low, close, volume, source.
"""

import logging
from datetime import date, timedelta
from typing import Optional
import httpx
import yfinance as yf
from app.config import TWELVE_DATA_API_KEY

logger = logging.getLogger(__name__)

# How many trading days to fetch when the cache is stale / empty.
DEFAULT_LOOKBACK = 100


def _business_days_ago(n: int) -> date:
    """Return the calendar date approximately n trading days in the past."""
    # Rough approximation: 1.4× calendar days covers weekends + holidays.
    return date.today() - timedelta(days=int(n * 1.4) + 5)


# ---------------------------------------------------------------------------
# Twelve Data
# ---------------------------------------------------------------------------

class TwelveDataError(Exception):
    """Raised when Twelve Data returns a non-200 or rate-limit response."""


def fetch_from_twelve_data(symbol: str, lookback_days: int = DEFAULT_LOOKBACK) -> list[dict]:
    """
    Fetch daily OHLCV bars from Twelve Data.

    Raises TwelveDataError on quota exhaustion or API errors so the caller
    can fall back to yfinance.
    """
    if not TWELVE_DATA_API_KEY:
        raise TwelveDataError("TWELVE_DATA_API_KEY not configured")

    url = "https://api.twelvedata.com/time_series"
    params = {
        "symbol": symbol,
        "interval": "1day",
        "outputsize": lookback_days,
        "order": "ASC",
        "apikey": TWELVE_DATA_API_KEY,
    }

    response = httpx.get(url, params=params, timeout=15)
    response.raise_for_status()
    payload = response.json()

    # Twelve Data signals quota exhaustion via status field, not HTTP status.
    status = payload.get("status", "ok")
    code = payload.get("code", 0)
    if status != "ok" or code in (429, 400, 401, 403):
        raise TwelveDataError(
            f"Twelve Data error for {symbol}: status={status} code={code} "
            f"message={payload.get('message', '')}"
        )

    values = payload.get("values")
    if not values:
        raise TwelveDataError(f"No data returned from Twelve Data for {symbol}")

    bars = []
    for v in values:
        bars.append({
            "symbol": symbol.upper(),
            "date": v["datetime"],  # "YYYY-MM-DD"
            "open": float(v["open"]),
            "high": float(v["high"]),
            "low": float(v["low"]),
            "close": float(v["close"]),
            "volume": int(float(v["volume"])),
            "source": "twelve_data",
        })
    return bars


# ---------------------------------------------------------------------------
# yfinance fallback
# ---------------------------------------------------------------------------

def fetch_from_yfinance(symbol: str, lookback_days: int = DEFAULT_LOOKBACK) -> list[dict]:
    """
    Fetch daily OHLCV bars from yfinance.

    Used as a fallback when Twelve Data quota is exhausted.
    """
    start = _business_days_ago(lookback_days).isoformat()
    ticker = yf.Ticker(symbol)
    df = ticker.history(start=start, interval="1d", auto_adjust=True)

    if df.empty:
        raise ValueError(f"yfinance returned no data for {symbol}")

    bars = []
    for ts, row in df.iterrows():
        bars.append({
            "symbol": symbol.upper(),
            "date": ts.date().isoformat(),  # "YYYY-MM-DD"
            "open": float(row["Open"]),
            "high": float(row["High"]),
            "low": float(row["Low"]),
            "close": float(row["Close"]),
            "volume": int(row["Volume"]),
            "source": "yfinance",
        })
    return bars


# ---------------------------------------------------------------------------
# Unified entry point
# ---------------------------------------------------------------------------

def fetch_ohlcv(symbol: str, lookback_days: int = DEFAULT_LOOKBACK) -> list[dict]:
    """
    Fetch daily OHLCV for symbol. Tries Twelve Data first; falls back to
    yfinance if Twelve Data is unavailable or quota-exhausted.
    """
    try:
        bars = fetch_from_twelve_data(symbol, lookback_days)
        logger.info("Twelve Data OK for %s (%d bars)", symbol, len(bars))
        return bars
    except TwelveDataError as exc:
        logger.warning("Twelve Data failed for %s (%s) — falling back to yfinance", symbol, exc)

    bars = fetch_from_yfinance(symbol, lookback_days)
    logger.info("yfinance OK for %s (%d bars)", symbol, len(bars))
    return bars
