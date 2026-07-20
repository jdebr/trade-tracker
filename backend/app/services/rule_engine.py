"""
Expression rule engine — the shared evaluator behind custom indicators (M19)
and custom alerts (M21).

Rules use the JsonLogic format (https://jsonlogic.com): a rule node is either a
literal (number, bool, string, null), a variable reference ``{"var": "name"}``,
or an operator applied to a list of operand nodes, e.g. ``{"<": [{"var":"rsi_14"}, 35]}``.

We evaluate with a small strict interpreter rather than stock JsonLogic because
JsonLogic inherits JavaScript's null coercion (``null < 35`` → ``true``), which is
dangerous for trading rules: a missing indicator must never satisfy a comparison.

Strict null semantics:
  - any comparison (== != < <= > >=) with a null operand  -> False
  - any arithmetic (+ - * /) with a null operand           -> None (propagates)
  - a bare variable {"var": x} is truthy-cast; null is falsy
  - and / or / ! compose over the above and return real booleans

so ``bb_squeeze OR rsi_14 < 35`` still fires on the squeeze when ``rsi_14`` is null.

`evaluate` assumes a structurally valid rule and raises `RuleError` on a malformed
one; callers that run stored rules in bulk (the screener, the alert engine) should
wrap each rule so a single bad one cannot abort the whole pass. Use `validate`
as the pre-flight check before persisting a rule.

Public API:
    evaluate(rule, features)      -> bool
    extract_variables(rule)       -> set[str]
    validate(rule, known_vars)    -> list[str]     ([] means valid)
    format_human(rule, labels)    -> str
"""

import operator

COMPARISON_OPS = {"==", "!=", "<", "<=", ">", ">="}
ARITHMETIC_OPS = {"+", "-", "*", "/"}
LOGICAL_OPS    = {"and", "or", "!", "!!"}
VAR_OP         = "var"
ALLOWED_OPS    = COMPARISON_OPS | ARITHMETIC_OPS | LOGICAL_OPS | {VAR_OP}

# Safety caps — a stored rule cannot be allowed to be pathologically large/deep.
MAX_NODES = 100
MAX_DEPTH = 10

_ORDER_FN = {"<": operator.lt, "<=": operator.le, ">": operator.gt, ">=": operator.ge}


class RuleError(Exception):
    """Raised by `evaluate` when a rule is structurally malformed."""


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

def _truthy(value) -> bool:
    """None is falsy; everything else uses Python truthiness."""
    return False if value is None else bool(value)


def _var_name(args):
    """A `var` operand is either "name" or ["name"] (JsonLogic allows both)."""
    return args[0] if isinstance(args, list) else args


def _compare(op: str, vals: list):
    # Strict null: any null operand makes the comparison unsatisfiable.
    if any(v is None for v in vals):
        return False
    try:
        if op == "==":
            return vals[0] == vals[1]
        if op == "!=":
            return vals[0] != vals[1]
        fn = _ORDER_FN[op]
        # 2 operands: a OP b. 3 operands: a OP b OP c (range).
        return all(fn(vals[i], vals[i + 1]) for i in range(len(vals) - 1))
    except TypeError:
        # Mismatched types (e.g. comparing a string var with <) — treat as
        # unsatisfiable rather than crashing a scan.
        return False


def _arith(op: str, vals: list):
    if any(v is None for v in vals):
        return None
    a, b = vals[0], vals[1]
    try:
        if op == "+":
            return a + b
        if op == "-":
            return a - b
        if op == "*":
            return a * b
        if op == "/":
            return a / b if b != 0 else None
    except TypeError:
        return None


def _require_arity(op: str, n: int) -> None:
    if op in ("==", "!=") and n != 2:
        raise RuleError(f"{op!r} expects 2 operands, got {n}")
    if op in ("<", "<=", ">", ">=") and n not in (2, 3):
        raise RuleError(f"{op!r} expects 2 or 3 operands, got {n}")
    if op in ARITHMETIC_OPS and n != 2:
        raise RuleError(f"{op!r} expects 2 operands, got {n}")
    if op in ("!", "!!") and n != 1:
        raise RuleError(f"{op!r} expects 1 operand, got {n}")
    if op in ("and", "or") and n < 1:
        raise RuleError(f"{op!r} expects at least 1 operand")


def _eval(node, features: dict, depth: int = 0):
    # Literals evaluate to themselves.
    if node is None or isinstance(node, (bool, int, float, str)):
        return node
    if not isinstance(node, dict) or len(node) != 1:
        raise RuleError(f"malformed node: {node!r}")
    # evaluate is self-defending: even on an unvalidated rule it raises RuleError
    # (the type callers wrap) rather than RecursionError/IndexError, so one bad
    # stored rule can never abort a bulk scan.
    if depth > MAX_DEPTH:
        raise RuleError(f"expression nested too deeply (max depth {MAX_DEPTH})")

    op, args = next(iter(node.items()))

    if op == VAR_OP:
        name = _var_name(args)
        if not isinstance(name, str):
            raise RuleError(f"var name must be a string: {args!r}")
        return features.get(name)

    if op not in ALLOWED_OPS:
        raise RuleError(f"unknown operator: {op!r}")
    if not isinstance(args, list):
        raise RuleError(f"operator {op!r} expects a list of operands")
    _require_arity(op, len(args))

    if op in COMPARISON_OPS:
        return _compare(op, [_eval(a, features, depth + 1) for a in args])
    if op in ARITHMETIC_OPS:
        return _arith(op, [_eval(a, features, depth + 1) for a in args])
    if op == "and":
        return all(_truthy(_eval(a, features, depth + 1)) for a in args)
    if op == "or":
        return any(_truthy(_eval(a, features, depth + 1)) for a in args)
    if op == "!":
        return not _truthy(_eval(args[0], features, depth + 1))
    # op == "!!"
    return _truthy(_eval(args[0], features, depth + 1))


def evaluate(rule, features: dict) -> bool:
    """Evaluate a validated rule against a feature dict, returning a boolean.

    Self-defending: raises RuleError on a malformed/unvalidated rule (never a bare
    RecursionError/IndexError), so bulk callers can wrap a single try/except.
    """
    return _truthy(_eval(rule, features))


# ---------------------------------------------------------------------------
# Introspection
# ---------------------------------------------------------------------------

def extract_variables(rule) -> set[str]:
    """Return the set of variable names a rule references (walks the AST)."""
    found: set[str] = set()

    def walk(node):
        if not isinstance(node, dict) or len(node) != 1:
            return
        op, args = next(iter(node.items()))
        if op == VAR_OP:
            name = _var_name(args)
            if isinstance(name, str):
                found.add(name)
            return
        if isinstance(args, list):
            for a in args:
                walk(a)

    walk(rule)
    return found


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate(rule, known_vars=None) -> list[str]:
    """
    Return a list of human-readable error messages; an empty list means the rule
    is valid. Checks operator allowlist, operand arity, unknown variables (when
    `known_vars` is supplied), structural well-formedness, and the depth/size caps.
    """
    errors: list[str] = []
    node_count = 0

    def check(node, depth):
        nonlocal node_count
        node_count += 1
        if depth > MAX_DEPTH:
            errors.append(f"expression nested too deeply (max depth {MAX_DEPTH})")
            return
        if node is None or isinstance(node, (bool, int, float, str)):
            return  # literal
        if not isinstance(node, dict) or len(node) != 1:
            errors.append(f"malformed node: {node!r}")
            return

        op, args = next(iter(node.items()))
        if op not in ALLOWED_OPS:
            errors.append(f"operator not allowed: {op!r}")
            return

        if op == VAR_OP:
            name = _var_name(args)
            if not isinstance(name, str):
                errors.append(f"var name must be a string: {args!r}")
            elif known_vars is not None and name not in known_vars:
                errors.append(f"unknown variable: {name!r}")
            return

        if not isinstance(args, list):
            errors.append(f"operator {op!r} expects a list of operands")
            return

        n = len(args)
        if op in ("==", "!=") and n != 2:
            errors.append(f"{op!r} expects 2 operands, got {n}")
        elif op in ("<", "<=", ">", ">=") and n not in (2, 3):
            errors.append(f"{op!r} expects 2 or 3 operands, got {n}")
        elif op in ARITHMETIC_OPS and n != 2:
            errors.append(f"{op!r} expects 2 operands, got {n}")
        elif op in ("!", "!!") and n != 1:
            errors.append(f"{op!r} expects 1 operand, got {n}")
        elif op in ("and", "or") and n < 1:
            errors.append(f"{op!r} expects at least 1 operand")

        for a in args:
            check(a, depth + 1)

    check(rule, 0)
    if node_count > MAX_NODES:
        errors.append(f"expression too large ({node_count} nodes, max {MAX_NODES})")
    return errors


# ---------------------------------------------------------------------------
# Human-readable formatting
# ---------------------------------------------------------------------------

_OP_SYMBOL = {
    "==": "=", "!=": "≠", "<": "<", "<=": "≤", ">": ">", ">=": "≥",
    "+": "+", "-": "−", "*": "×", "/": "÷",
}


def _num(v) -> str:
    f = float(v)
    return str(int(f)) if f.is_integer() else f"{f:g}"


def format_human(rule, labels=None) -> str:
    """
    Render a rule as a readable string, e.g. `RSI(14) < 35 AND BB Squeeze`.
    `labels` maps variable names to display labels (defaults to raw names).
    """
    labels = labels or {}

    def fmt(node) -> str:
        # Defensive: format_human is called on unvalidated input by the routes,
        # so it must render a fallback string rather than raise on a malformed rule.
        if node is None:
            return "null"
        if isinstance(node, bool):
            return "true" if node else "false"
        if isinstance(node, (int, float)):
            return _num(node)
        if isinstance(node, str):
            return f'"{node}"'
        if isinstance(node, dict) and len(node) == 1:
            op, args = next(iter(node.items()))
            if op == VAR_OP:
                name = _var_name(args)
                return labels.get(name, name) if isinstance(name, str) else str(node)
            if isinstance(args, list):
                if op in ("and", "or"):
                    sep = f" {op.upper()} "
                    return "(" + sep.join(fmt(a) for a in args) + ")"
                if op == "!" and len(args) == 1:
                    return "NOT " + fmt(args[0])
                if op == "!!" and len(args) == 1:
                    return fmt(args[0])
                if op in _OP_SYMBOL:
                    return f" {_OP_SYMBOL[op]} ".join(fmt(a) for a in args)
        return str(node)

    rendered = fmt(rule)
    # Drop redundant parentheses wrapping the whole expression.
    if rendered.startswith("(") and rendered.endswith(")"):
        rendered = rendered[1:-1]
    return rendered
