from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class WatchlistEntry(BaseModel):
    id: str
    symbol: str
    group_name: Optional[str] = None
    notes: Optional[str] = None
    added_at: datetime


class WatchlistAdd(BaseModel):
    symbol: str
    group_name: Optional[str] = None
    notes: Optional[str] = None


class WatchlistUpdate(BaseModel):
    group_name: Optional[str] = None
    notes: Optional[str] = None
