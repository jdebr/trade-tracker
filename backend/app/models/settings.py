from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class Settings(BaseModel):
    account_size: float
    risk_per_trade_pct: float
    max_position_pct: float
    default_stop_method: str
    default_atr_mult: float
    default_stop_pct: float
    default_target_method: str
    default_target_r: float
    default_target_pct: float
    trail_enabled: bool
    trail_atr_mult: float
    time_stop_days: int
    updated_at: datetime


class SettingsUpdate(BaseModel):
    account_size: Optional[float] = Field(None, gt=0)
    risk_per_trade_pct: Optional[float] = Field(None, gt=0, le=100)
    max_position_pct: Optional[float] = Field(None, gt=0, le=100)
    default_stop_method: Optional[str] = None
    default_atr_mult: Optional[float] = Field(None, gt=0)
    default_stop_pct: Optional[float] = Field(None, gt=0, lt=100)
    default_target_method: Optional[str] = None
    default_target_r: Optional[float] = Field(None, gt=0)
    default_target_pct: Optional[float] = Field(None, gt=0)
    trail_enabled: Optional[bool] = None
    trail_atr_mult: Optional[float] = Field(None, gt=0)
    time_stop_days: Optional[int] = Field(None, ge=0)
