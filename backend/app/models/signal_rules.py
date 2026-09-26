from pydantic import BaseModel, ConfigDict, Field, model_validator
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
    # Server-computed human-readable form of `expression` (e.g. "RSI(14) < 30"), so
    # the management UI can list rules without re-deriving it or calling /rules.
    formatted: Optional[str] = None


class SignalRuleCreate(BaseModel):
    name: str = Field(min_length=1)
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

    name: Optional[str] = Field(None, min_length=1)
    description: Optional[str] = None
    type: Optional[str] = None
    weight: Optional[int] = Field(None, ge=1)
    enabled: Optional[bool] = None
    sort_order: Optional[int] = None

    @model_validator(mode="after")
    def _no_null_for_required_columns(self):
        # A present null means "clear it" (see update_rule). Only the optional
        # columns can be cleared; nulling a NOT NULL column must be a 422, not a
        # database error surfacing as a 500.
        for f in ("name", "weight", "enabled", "sort_order"):
            if f in self.model_fields_set and getattr(self, f) is None:
                raise ValueError(f"{f} cannot be null")
        return self
