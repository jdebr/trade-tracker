from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class ScreenerCandidate(BaseModel):
    symbol: str
    rank: int
    signal_score: int           # 0–4
    bb_squeeze: Optional[bool] = None
    rsi_14: Optional[float] = None
    rsi_in_range: Optional[bool] = None
    above_ema50: Optional[bool] = None
    volume_expansion: Optional[bool] = None
    close_price: Optional[float] = None


class ScreenerRunResponse(BaseModel):
    run_at: datetime
    pass1_count: int            # survivors after Pass 1
    pass2_count: int            # survivors after Pass 2 (score ≥ 1)
    candidates: list[ScreenerCandidate]


class ScreenerResultRow(BaseModel):
    id: str
    run_at: datetime
    symbol: str
    rank: Optional[int] = None
    signal_score: int
    bb_squeeze: Optional[bool] = None
    rsi_14: Optional[float] = None
    rsi_in_range: Optional[bool] = None
    above_ema50: Optional[bool] = None
    volume_expansion: Optional[bool] = None
    close_price: Optional[float] = None
    notes: Optional[str] = None
