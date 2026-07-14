from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime


class Alert(BaseModel):
    id: str
    symbol: str
    date: date
    alert_type: str
    # 'opportunity' — screener/scanner/intraday found a trade idea.
    # 'position'    — a trade you actually hold hit a stop, target, or time limit.
    category: str = "opportunity"
    position_id: Optional[str] = None
    signal_score: Optional[int] = None
    price_at_trigger: Optional[float] = None
    details: Optional[dict] = None
    acknowledged: bool
    triggered_at: datetime


class AlertAcknowledgeResponse(BaseModel):
    id: str
    acknowledged: bool


class AlertBulkAcknowledgeResponse(BaseModel):
    acknowledged_count: int
