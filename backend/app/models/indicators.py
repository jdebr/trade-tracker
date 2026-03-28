from pydantic import BaseModel
from typing import Optional
from datetime import date


class IndicatorSnapshot(BaseModel):
    symbol: str
    date: date
    rsi_14: Optional[float] = None
    macd_line: Optional[float] = None
    macd_signal: Optional[float] = None
    macd_hist: Optional[float] = None
    bb_upper: Optional[float] = None
    bb_middle: Optional[float] = None
    bb_lower: Optional[float] = None
    bb_width: Optional[float] = None
    bb_squeeze: Optional[bool] = None
    ema_8: Optional[float] = None
    ema_21: Optional[float] = None
    ema_50: Optional[float] = None
    atr_14: Optional[float] = None
    obv: Optional[int] = None


class IndicatorComputeRequest(BaseModel):
    symbols: list[str]


class IndicatorComputeResponse(BaseModel):
    computed: list[str]   # symbols successfully computed and upserted
    skipped: list[str]    # symbols with insufficient OHLCV data
    failed: list[str]     # symbols that errored
    rows_upserted: int
