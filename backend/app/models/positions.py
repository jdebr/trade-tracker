from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import date, datetime


# ---------------------------------------------------------------------------
# Exit plan (POST /positions/plan) — pure calculation, nothing persisted
# ---------------------------------------------------------------------------

class ExitPlanRequest(BaseModel):
    symbol: str
    entry_price: float = Field(gt=0)
    direction: Literal["long"] = "long"

    # Every field below is optional — omitted values fall back to app_settings.
    stop_method: Optional[str] = None
    target_method: Optional[str] = None
    atr_mult: Optional[float] = Field(None, gt=0)
    stop_pct: Optional[float] = Field(None, gt=0, lt=100)
    target_r: Optional[float] = Field(None, gt=0)
    target_pct: Optional[float] = Field(None, gt=0)
    manual_stop: Optional[float] = Field(None, gt=0)
    manual_target: Optional[float] = Field(None, gt=0)
    account_size: Optional[float] = Field(None, gt=0)
    risk_pct: Optional[float] = Field(None, gt=0, le=100)
    entry_date: Optional[date] = None


class ExitPlanResponse(BaseModel):
    symbol: str
    direction: str
    entry_price: float

    stop_method: str
    stop_price: float
    target_method: str
    target_price: Optional[float] = None

    risk_per_share: float
    reward_per_share: Optional[float] = None
    rr_ratio: Optional[float] = None

    shares: int
    risk_amount: float
    position_value: float
    position_pct_of_account: float

    time_stop_date: Optional[str] = None
    trail_enabled: bool
    trail_atr_mult: float

    stop_candidates: dict
    target_candidates: dict

    warnings: list[str]
    params: dict


# ---------------------------------------------------------------------------
# Positions
# ---------------------------------------------------------------------------

class PositionOpen(BaseModel):
    """
    Open a position. The client sends the plan it settled on; the server
    recomputes risk and sizing from these numbers rather than trusting any
    derived values the client might send.
    """
    symbol: str
    entry_price: float = Field(gt=0)
    shares: float = Field(gt=0)
    stop_price: float = Field(gt=0)
    target_price: Optional[float] = Field(None, gt=0)

    direction: Literal["long"] = "long"
    is_simulated: bool = True          # real money is opt-in
    entry_date: Optional[date] = None  # defaults to today

    stop_method: Optional[str] = None
    target_method: Optional[str] = None
    exit_plan: Optional[dict] = None
    time_stop_date: Optional[date] = None

    alert_id: Optional[str] = None
    screener_result_id: Optional[str] = None
    notes: Optional[str] = None


class PositionUpdate(BaseModel):
    """Revise an open position's plan. Any change to stop/target is logged as an event."""
    stop_price: Optional[float] = Field(None, gt=0)
    target_price: Optional[float] = Field(None, gt=0)
    time_stop_date: Optional[date] = None
    notes: Optional[str] = None


class PositionClose(BaseModel):
    exit_price: float = Field(gt=0)
    exit_date: Optional[date] = None   # defaults to today
    exit_reason: Literal[
        "target_hit", "stop_hit", "trailing_stop", "time_stop", "manual", "earnings"
    ] = "manual"
    notes: Optional[str] = None


class Position(BaseModel):
    id: str
    symbol: str
    direction: str
    is_simulated: bool
    status: str

    alert_id: Optional[str] = None
    screener_result_id: Optional[str] = None

    entry_date: date
    entry_price: float
    shares: float
    position_value: Optional[float] = None

    initial_stop_price: float
    stop_price: float
    target_price: Optional[float] = None
    stop_method: Optional[str] = None
    target_method: Optional[str] = None
    exit_plan: Optional[dict] = None
    time_stop_date: Optional[date] = None

    risk_per_share: float
    risk_amount: float
    entry_signals: Optional[dict] = None

    exit_date: Optional[date] = None
    exit_price: Optional[float] = None
    exit_reason: Optional[str] = None
    pnl: Optional[float] = None
    pnl_pct: Optional[float] = None
    r_multiple: Optional[float] = None
    hold_days: Optional[int] = None

    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class PositionEvent(BaseModel):
    id: str
    position_id: str
    event_type: str
    occurred_at: datetime
    price: Optional[float] = None
    payload: Optional[dict] = None
    alert_id: Optional[str] = None


class PositionDetail(Position):
    events: list[PositionEvent] = []
