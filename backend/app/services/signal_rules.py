"""
Signal rules — user-defined, named scoring rules evaluated by the M18 engine.

A "signal" is a named JsonLogic boolean over the feature dict (see feature_context).
The four screener Pass-2 signals are seeded as builtin rows, so screener scoring is
data-driven rather than hardcoded. This is distinct from "indicators", which compute
the underlying technical values into indicator_snapshots.

`evaluate_signals` is the shared scoring primitive used by both the screener and
position entry-signal attribution: it evaluates each enabled rule against a feature
context and returns the per-slug results plus the (raw and normalized) score. A
single rule that fails to evaluate is treated as not-firing and logged — one bad
stored rule can never abort a scan.

Public API:
    get_enabled_rules() -> list[dict]
    evaluate_signals(features, rules) -> dict
    validate_expression(expression) -> list[str]
    list_rules(enabled, include_deleted) -> list[dict]
    get_rule(rule_id) -> dict | None
    get_rule_by_slug(slug) -> dict | None
    create_rule(data) -> dict
    update_rule(rule_id, data) -> dict | None
    soft_delete_rule(rule_id) -> dict | None
    restore_rule(rule_id) -> dict | None
    slugify(name) -> str
"""

import logging
import re
from datetime import datetime, timezone

from app.database import get_client
from app.services.feature_context import VARIABLE_NAMES
from app.services.rule_engine import RuleError, evaluate, validate

logger = logging.getLogger(__name__)

TABLE = "signal_rules"

# The builtin slugs that the screener dual-writes into legacy columns.
LEGACY_SLUGS = ("bb_squeeze", "rsi_in_range", "above_ema50", "volume_expansion")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def get_enabled_rules() -> list[dict]:
    """Enabled, non-deleted signal rules, ordered by sort_order."""
    result = (
        get_client()
        .table(TABLE)
        .select("*")
        .eq("enabled", True)
        .is_("deleted_at", "null")
        .order("sort_order")
        .execute()
    )
    return result.data or []


def evaluate_signals(features: dict, rules: list[dict]) -> dict:
    """
    Evaluate every rule against `features`. Returns:
        signals                  {slug: bool}
        signal_score             sum of weights of rules that fired
        max_signal_score         sum of all rule weights (the denominator)
        signal_score_normalized  signal_score / max_signal_score, or None if no rules
    """
    signals: dict[str, bool] = {}
    score = 0
    max_score = 0
    for rule in rules:
        w = rule.get("weight")
        weight = int(w) if w is not None else 1  # honor the stored value (don't coerce 0→1)
        max_score += weight
        try:
            fired = evaluate(rule["expression"], features)
        except RuleError as exc:
            logger.warning("signal rule %r failed to evaluate: %s", rule.get("slug"), exc)
            fired = False
        signals[rule["slug"]] = fired
        if fired:
            score += weight

    normalized = round(score / max_score, 4) if max_score else None
    return {
        "signals": signals,
        "signal_score": score,
        "max_signal_score": max_score,
        "signal_score_normalized": normalized,
    }


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def slugify(name: str) -> str:
    """Normalize a display name to a single-token slug."""
    slug = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    return slug or "signal"


def validate_expression(expression) -> list[str]:
    """Return validation errors for an expression against the known variable set."""
    return validate(expression, VARIABLE_NAMES)


def list_rules(enabled: bool | None = None, include_deleted: bool = False) -> list[dict]:
    q = get_client().table(TABLE).select("*")
    if enabled is not None:
        q = q.eq("enabled", enabled)
    if not include_deleted:
        q = q.is_("deleted_at", "null")
    return q.order("sort_order").execute().data or []


def get_rule(rule_id: str) -> dict | None:
    r = get_client().table(TABLE).select("*").eq("id", rule_id).limit(1).execute().data
    return r[0] if r else None


def get_rule_by_slug(slug: str) -> dict | None:
    r = get_client().table(TABLE).select("*").eq("slug", slug).limit(1).execute().data
    return r[0] if r else None


def create_rule(data: dict) -> dict:
    payload = {
        "slug":        data.get("slug") or slugify(data["name"]),
        "name":        data["name"],
        "description": data.get("description"),
        "type":        data.get("type"),
        "expression":  data["expression"],
        "weight":      int(data.get("weight") or 1),
        "enabled":     data.get("enabled", True),
        "is_builtin":  False,
        "sort_order":  int(data.get("sort_order") or 0),
    }
    return get_client().table(TABLE).insert(payload).execute().data[0]


def update_rule(rule_id: str, data: dict) -> dict | None:
    payload = {k: v for k, v in data.items() if v is not None}
    payload["updated_at"] = _now()
    r = get_client().table(TABLE).update(payload).eq("id", rule_id).execute().data
    return r[0] if r else None


def soft_delete_rule(rule_id: str) -> dict | None:
    r = (
        get_client()
        .table(TABLE)
        .update({"deleted_at": _now(), "enabled": False, "updated_at": _now()})
        .eq("id", rule_id)
        .execute()
        .data
    )
    return r[0] if r else None


def restore_rule(rule_id: str) -> dict | None:
    r = (
        get_client()
        .table(TABLE)
        .update({"deleted_at": None, "enabled": True, "updated_at": _now()})
        .eq("id", rule_id)
        .execute()
        .data
    )
    return r[0] if r else None
