"""
Signal-rule CRUD — user-defined scoring rules for the screener.

Expressions are validated against the rule engine's known variable set on create
and update; a bad or unknown-variable rule is rejected with 422 rather than
persisted and silently failing during a scan.
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.models.signal_rules import SignalRule, SignalRuleCreate, SignalRuleUpdate
from app.services import signal_rules as sr
from app.services.feature_context import VARIABLE_LABELS
from app.services.rule_engine import format_human

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/signal-rules", tags=["signal-rules"])


def _present(rule: dict) -> dict:
    """Attach the server-computed human-readable expression for the UI."""
    return {**rule, "formatted": format_human(rule.get("expression") or {}, VARIABLE_LABELS)}


def _require(rule_id: str) -> dict:
    rule = sr.get_rule(rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail=f"signal rule {rule_id} not found")
    return rule


@router.get("", response_model=list[SignalRule])
def list_signal_rules(
    enabled: Optional[bool] = Query(None),
    include_deleted: bool = Query(False),
):
    return [_present(r) for r in sr.list_rules(enabled=enabled, include_deleted=include_deleted)]


@router.get("/{rule_id}", response_model=SignalRule)
def get_signal_rule(rule_id: str):
    return _present(_require(rule_id))


@router.post("", response_model=SignalRule, status_code=201)
def create_signal_rule(body: SignalRuleCreate):
    errors = sr.validate_expression(body.expression)
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors})

    data = body.model_dump()
    # The slug is the permanent attribution key — always normalize it, even when
    # the client supplies one.
    slug = sr.slugify(data.get("slug") or data["name"])
    existing = sr.get_rule_by_slug(slug)
    if existing:
        # Slugs stay reserved after a soft delete (attribution history points at
        # them), so say so — otherwise the user can't see what they collided with.
        where = " (it was removed — restore it instead)" if existing.get("deleted_at") else ""
        raise HTTPException(
            status_code=409,
            detail=f"a signal named '{existing.get('name', slug)}' already exists{where}",
        )
    data["slug"] = slug
    try:
        created = sr.create_rule(data)
    except Exception as e:
        # Race: a concurrent create took the slug between the check and the insert.
        if "23505" in str(e) or "duplicate key" in str(e):
            raise HTTPException(status_code=409, detail=f"a signal with slug '{slug}' already exists")
        raise
    return _present(created)


def _warn_if_builtin_deactivated(rule: dict, action: str) -> None:
    """A disabled/deleted builtin stops feeding its dual-written legacy
    screener_results column, which /status/summary and the Screener still read."""
    if rule.get("is_builtin"):
        logger.warning(
            "%s builtin signal %r — its legacy screener_results column will no longer be written",
            action, rule.get("slug"),
        )


@router.patch("/{rule_id}", response_model=SignalRule)
def update_signal_rule(rule_id: str, body: SignalRuleUpdate):
    # expression/slug are immutable (rejected by the model's extra="forbid"), so
    # there is nothing here that can invalidate the rule — no re-validation needed.
    rule = _require(rule_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("enabled") is False:
        _warn_if_builtin_deactivated(rule, "Disabling")
    return _present(sr.update_rule(rule_id, data))


@router.delete("/{rule_id}", response_model=SignalRule)
def delete_signal_rule(rule_id: str):
    rule = _require(rule_id)
    _warn_if_builtin_deactivated(rule, "Soft-deleting")
    return _present(sr.soft_delete_rule(rule_id))


@router.post("/{rule_id}/restore", response_model=SignalRule)
def restore_signal_rule(rule_id: str):
    _require(rule_id)
    return _present(sr.restore_rule(rule_id))
