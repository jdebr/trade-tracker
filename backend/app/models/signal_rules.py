from pydantic import BaseModel, ConfigDict, Field
from typing import Any, Optional
from datetime import datetime


class SignalRule(BaseModel):
    id: str
    slug: str
    name: str
    description: Optional[str] = None
    type: Optional[str] = None
    expression: dict[str, Any]
    weight: int
    enabled: bool
    is_builtin: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None


class SignalRuleCreate(BaseModel):
    name: str
    expression: dict[str, Any]
    description: Optional[str] = None
    type: Optional[str] = None
    weight: int = Field(1, ge=1)
    enabled: bool = True
    slug: Optional[str] = None
    sort_order: int = 0


class SignalRuleUpdate(BaseModel):
    # A signal's `expression` (and `slug`) are immutable once created — editing the
    # logic would silently change the meaning of every historical attribution that
    # references the slug. To change the logic, clone to a new signal. `extra="forbid"`
    # so an attempt to PATCH `expression`/`slug` is rejected (422) rather than ignored.
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = None
    description: Optional[str] = None
    type: Optional[str] = None
    weight: Optional[int] = Field(None, ge=1)
    enabled: Optional[bool] = None
    sort_order: Optional[int] = None
