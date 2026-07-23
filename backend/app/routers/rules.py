"""
Rule engine endpoints — the primitives the M19/M21 builders consume.

Nothing here persists a rule; these are pure calculation/introspection routes.
"""

import logging

from fastapi import APIRouter

from app.models.rules import (
    RulePreviewRequest,
    RulePreviewResponse,
    RulePreviewUniverseRequest,
    RulePreviewUniverseResponse,
    RuleValidateRequest,
    RuleValidateResponse,
    VariablesResponse,
)
from app.services import screener
from app.services.feature_context import (
    VARIABLE_LABELS,
    VARIABLE_NAMES,
    VARIABLE_REGISTRY,
    build_feature_context,
)
from app.services.rule_engine import (
    evaluate,
    extract_variables,
    format_human,
    validate,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/rules", tags=["rules"])


@router.get("/variables", response_model=VariablesResponse)
def list_variables():
    """Return every variable a rule may reference, with display metadata."""
    return {"variables": VARIABLE_REGISTRY}


@router.post("/validate", response_model=RuleValidateResponse)
def validate_rule(body: RuleValidateRequest):
    """Validate a rule against the known variable set; never evaluates."""
    errors = validate(body.rule, VARIABLE_NAMES)
    return {
        "valid": not errors,
        "errors": errors,
        "variables_used": sorted(extract_variables(body.rule)),
        "formatted": format_human(body.rule, VARIABLE_LABELS),
    }


@router.post("/preview", response_model=RulePreviewResponse)
def preview_rule(body: RulePreviewRequest):
    """
    Evaluate a rule against a single symbol's live feature context, so a builder
    can show a real result. Returns validation errors (without evaluating) if the
    rule is invalid.
    """
    symbol = body.symbol.upper()
    vars_used = sorted(extract_variables(body.rule))
    formatted = format_human(body.rule, VARIABLE_LABELS)

    errors = validate(body.rule, VARIABLE_NAMES)
    if errors:
        return {
            "symbol": symbol, "value": False, "variables_used": vars_used,
            "features_used": {}, "formatted": formatted, "errors": errors,
        }

    features = build_feature_context(symbol)
    value = evaluate(body.rule, features)
    return {
        "symbol": symbol,
        "value": value,
        "variables_used": vars_used,
        "features_used": {v: features.get(v) for v in vars_used},
        "formatted": formatted,
        "errors": [],
    }


@router.post("/preview-universe", response_model=RulePreviewUniverseResponse)
def preview_rule_universe(body: RulePreviewUniverseRequest):
    """
    Simulate a screener run for one candidate rule against the current cached
    data: return every Pass-1 symbol the rule fires on, plus the rule-relevant
    feature values. Cheap (no fetch, no recompute — same cache reads a run does).
    Returns validation errors without evaluating if the rule is invalid.
    """
    formatted = format_human(body.rule, VARIABLE_LABELS)
    errors = validate(body.rule, VARIABLE_NAMES)
    if errors:
        return {
            "universe_count": 0, "evaluated_count": 0, "match_count": 0,
            "matched": [], "values": {},
            "variables_used": sorted(extract_variables(body.rule)),
            "formatted": formatted, "errors": errors,
        }

    result = screener.preview_rule_over_universe(body.rule)
    return {**result, "formatted": formatted, "errors": []}
