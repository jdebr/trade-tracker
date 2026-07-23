from pydantic import BaseModel
from typing import Any


class VariableMeta(BaseModel):
    name: str
    type: str
    label: str
    group: str
    description: str


class VariablesResponse(BaseModel):
    variables: list[VariableMeta]


class RuleValidateRequest(BaseModel):
    rule: dict[str, Any]


class RuleValidateResponse(BaseModel):
    valid: bool
    errors: list[str]
    variables_used: list[str]
    formatted: str


class RulePreviewRequest(BaseModel):
    rule: dict[str, Any]
    symbol: str


class RulePreviewResponse(BaseModel):
    symbol: str
    value: bool
    variables_used: list[str]
    features_used: dict[str, Any]
    formatted: str
    errors: list[str] = []


class RulePreviewUniverseRequest(BaseModel):
    rule: dict[str, Any]


class RulePreviewUniverseResponse(BaseModel):
    universe_count: int       # Pass-1 survivors considered
    evaluated_count: int      # of those, how many had a usable snapshot
    match_count: int
    matched: list[str]                    # matching symbols, sorted
    values: dict[str, dict[str, Any]]     # {symbol: {var: value}} for matches only
    variables_used: list[str]
    formatted: str
    errors: list[str] = []
