from pydantic import BaseModel
from typing import Optional
from datetime import date


class OHLCVBar(BaseModel):
    symbol: str
    date: date
    open: float
    high: float
    low: float
    close: float
    volume: int
    source: str  # "twelve_data" or "yfinance"


class OHLCVFetchRequest(BaseModel):
    symbols: list[str]
    lookback_days: int = 100  # fetch 100 days on first load for EMA-50 reliability


class OHLCVFetchResponse(BaseModel):
    fetched: list[str]      # symbols that required an API call
    cached: list[str]       # symbols served from cache
    failed: list[str]       # symbols that errored
    bars_upserted: int
