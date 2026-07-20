"""
Tests for the expression rule engine.

Correctness metrics codified here:
  - every operator's truth table (comparison, logical, arithmetic)
  - the strict null-safety matrix (the whole reason we don't use stock JsonLogic)
  - chained range comparisons
  - extract_variables completeness on nested rules
  - validate catches every malformed class (bad op, unknown var, arity, depth, size)
  - format_human fidelity
  - evaluate raises RuleError on a malformed rule
"""

import pytest

from app.services.rule_engine import (
    MAX_DEPTH,
    MAX_NODES,
    RuleError,
    evaluate,
    extract_variables,
    format_human,
    validate,
)

FEATURES = {
    "rsi_14": 30.0,
    "bb_squeeze": True,
    "ema_50": 100.0,
    "close": 102.0,
    "atr_14": 3.0,
    "missing": None,
}


# ---------------------------------------------------------------------------
# Comparison operators
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("rule, expected", [
    ({"<":  [{"var": "rsi_14"}, 35]}, True),
    ({"<":  [{"var": "rsi_14"}, 30]}, False),
    ({"<=": [{"var": "rsi_14"}, 30]}, True),
    ({">":  [{"var": "close"}, {"var": "ema_50"}]}, True),
    ({">=": [{"var": "close"}, 102]}, True),
    ({"==": [{"var": "rsi_14"}, 30]}, True),
    ({"!=": [{"var": "rsi_14"}, 30]}, False),
    ({"==": [{"var": "bb_squeeze"}, True]}, True),
])
def test_comparisons(rule, expected):
    assert evaluate(rule, FEATURES) is expected


def test_chained_range_inclusive():
    # 35 <= rsi <= 65, rsi = 30 -> False; = 50 -> True
    rule = {"<=": [35, {"var": "rsi_14"}, 65]}
    assert evaluate(rule, FEATURES) is False
    assert evaluate(rule, {"rsi_14": 50.0}) is True


# ---------------------------------------------------------------------------
# Logical operators
# ---------------------------------------------------------------------------

def test_and_or_not():
    assert evaluate({"and": [{"<": [{"var": "rsi_14"}, 35]}, {"var": "bb_squeeze"}]}, FEATURES) is True
    assert evaluate({"and": [{"<": [{"var": "rsi_14"}, 35]}, {">": [{"var": "rsi_14"}, 40]}]}, FEATURES) is False
    assert evaluate({"or":  [{">": [{"var": "rsi_14"}, 40]}, {"var": "bb_squeeze"}]}, FEATURES) is True
    assert evaluate({"!":   [{"var": "bb_squeeze"}]}, FEATURES) is False


def test_bare_var_truthy_cast():
    assert evaluate({"var": "bb_squeeze"}, FEATURES) is True
    assert evaluate({"var": "bb_squeeze"}, {"bb_squeeze": False}) is False


# ---------------------------------------------------------------------------
# Arithmetic
# ---------------------------------------------------------------------------

def test_arithmetic_in_comparison():
    # close > ema_50 * 1.02 -> 102 > 102 -> False; ema_50 * 1.01 -> 102 > 101 -> True
    assert evaluate({">": [{"var": "close"}, {"*": [{"var": "ema_50"}, 1.02]}]}, FEATURES) is False
    assert evaluate({">": [{"var": "close"}, {"*": [{"var": "ema_50"}, 1.01]}]}, FEATURES) is True


def test_arithmetic_division_by_zero_is_null_safe():
    # atr_14 / 0 -> None -> comparison with None -> False
    assert evaluate({">": [{"/": [{"var": "atr_14"}, 0]}, 1]}, FEATURES) is False


@pytest.mark.parametrize("rule, expected", [
    ({"==": [{"+": [{"var": "rsi_14"}, 5]}, 35]}, True),    # 30 + 5 == 35
    ({"==": [{"-": [{"var": "rsi_14"}, 10]}, 20]}, True),   # 30 - 10 == 20
    ({"==": [{"/": [{"var": "close"}, 2]}, 51]}, True),     # 102 / 2 == 51
])
def test_arithmetic_all_ops(rule, expected):
    assert evaluate(rule, FEATURES) is expected


def test_chained_range_descending():
    # 65 >= rsi >= 20, rsi = 30 -> True ; rsi = 10 -> False
    rule = {">=": [65, {"var": "rsi_14"}, 20]}
    assert evaluate(rule, FEATURES) is True
    assert evaluate(rule, {"rsi_14": 10.0}) is False


def test_bool_compares_equal_to_int_documented_behavior():
    # Known/accepted: bb_squeeze coerces to a real bool and Python treats
    # True == 1, so a boolean var equals a numeric 1. Documented, not a bug.
    assert evaluate({"==": [{"var": "bb_squeeze"}, 1]}, FEATURES) is True
    assert evaluate({">": [{"var": "bb_squeeze"}, 0]}, FEATURES) is True


# ---------------------------------------------------------------------------
# Strict null safety — the core correctness property
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("op", ["<", "<=", ">", ">=", "==", "!="])
def test_comparison_with_null_operand_is_false(op):
    assert evaluate({op: [{"var": "missing"}, 35]}, FEATURES) is False


def test_or_still_fires_on_other_branch_when_one_is_null():
    # bb_squeeze OR missing < 35  -> True via the squeeze despite null
    rule = {"or": [{"var": "bb_squeeze"}, {"<": [{"var": "missing"}, 35]}]}
    assert evaluate(rule, FEATURES) is True


def test_null_propagates_through_arithmetic():
    # missing * 2 -> None -> enclosing comparison False
    assert evaluate({">": [{"*": [{"var": "missing"}, 2]}, 0]}, FEATURES) is False


def test_bare_null_var_is_falsy():
    assert evaluate({"var": "missing"}, FEATURES) is False
    assert evaluate({"var": "absent_entirely"}, FEATURES) is False


def test_type_mismatch_comparison_is_false_not_crash():
    assert evaluate({"<": [{"var": "s"}, 5]}, {"s": "text"}) is False


# ---------------------------------------------------------------------------
# extract_variables
# ---------------------------------------------------------------------------

def test_extract_variables_nested():
    rule = {"and": [
        {"<": [{"var": "rsi_14"}, 35]},
        {"or": [{"var": "bb_squeeze"}, {">": [{"var": "close"}, {"var": "ema_50"}]}]},
    ]}
    assert extract_variables(rule) == {"rsi_14", "bb_squeeze", "close", "ema_50"}


def test_extract_variables_empty_for_literal():
    assert extract_variables({"==": [1, 2]}) == set()


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

KNOWN = {"rsi_14", "bb_squeeze", "close", "ema_50"}


def test_validate_accepts_good_rule():
    assert validate({"<": [{"var": "rsi_14"}, 35]}, KNOWN) == []


def test_validate_rejects_unknown_variable():
    errors = validate({"<": [{"var": "not_a_var"}, 35]}, KNOWN)
    assert any("unknown variable" in e for e in errors)


def test_validate_rejects_disallowed_operator():
    errors = validate({"pow": [{"var": "rsi_14"}, 2]}, KNOWN)
    assert any("not allowed" in e for e in errors)


@pytest.mark.parametrize("rule", [
    {"==": [1, 2, 3]},         # == wants exactly 2
    {"<": [1]},                # < wants 2 or 3
    {"!": [1, 2]},             # ! wants 1
    {"+": [1, 2, 3]},          # arithmetic wants 2
])
def test_validate_rejects_bad_arity(rule):
    assert any("expects" in e for e in validate(rule, KNOWN))


def test_validate_rejects_malformed_node():
    errors = validate({"and": [{"var": "rsi_14"}, {"<": [1, 2], "extra": 3}]}, KNOWN)
    assert any("malformed" in e for e in errors)


def test_validate_enforces_depth_cap():
    rule = {"var": "rsi_14"}
    for _ in range(MAX_DEPTH + 2):
        rule = {"!": [rule]}
    assert any("deeply" in e for e in validate(rule, KNOWN))


def test_validate_enforces_size_cap():
    rule = {"and": [{"var": "bb_squeeze"} for _ in range(MAX_NODES + 5)]}
    assert any("too large" in e for e in validate(rule, KNOWN))


def test_validate_without_known_vars_skips_unknown_check():
    # When known_vars is None, unknown-variable checking is skipped.
    assert validate({"<": [{"var": "anything"}, 5]}) == []


# ---------------------------------------------------------------------------
# evaluate raises on malformed
# ---------------------------------------------------------------------------

def test_evaluate_raises_on_malformed():
    with pytest.raises(RuleError):
        evaluate({"<": [1, 2], "extra": 3}, FEATURES)
    with pytest.raises(RuleError):
        evaluate({"bogus_op": [1, 2]}, FEATURES)


@pytest.mark.parametrize("rule", [
    {"+": [1]},        # arithmetic needs 2
    {"<": []},         # comparison needs 2-3
    {"!": [1, 2]},     # unary needs 1
    {"and": []},       # needs >= 1
])
def test_evaluate_raises_ruleerror_on_bad_arity(rule):
    # evaluate is self-defending even on un-validated input: RuleError, not
    # a bare IndexError that would escape a bulk caller's try/except.
    with pytest.raises(RuleError):
        evaluate(rule, FEATURES)


def test_evaluate_raises_ruleerror_not_recursionerror_on_deep_nesting():
    rule = {"var": "rsi_14"}
    for _ in range(MAX_DEPTH + 5):
        rule = {"!": [rule]}
    with pytest.raises(RuleError):
        evaluate(rule, FEATURES)


# ---------------------------------------------------------------------------
# format_human
# ---------------------------------------------------------------------------

LABELS = {"rsi_14": "RSI(14)", "bb_squeeze": "BB Squeeze", "close": "Close", "ema_50": "EMA 50"}


def test_format_human_comparison():
    assert format_human({"<": [{"var": "rsi_14"}, 35]}, LABELS) == "RSI(14) < 35"


def test_format_human_chained_range():
    assert format_human({"<=": [35, {"var": "rsi_14"}, 65]}, LABELS) == "35 ≤ RSI(14) ≤ 65"


def test_format_human_and_strips_outer_parens():
    rule = {"and": [{"<": [{"var": "rsi_14"}, 35]}, {"var": "bb_squeeze"}]}
    assert format_human(rule, LABELS) == "RSI(14) < 35 AND BB Squeeze"


def test_format_human_nested_or_keeps_inner_parens():
    rule = {"and": [{"var": "bb_squeeze"}, {"or": [{"var": "close"}, {"var": "ema_50"}]}]}
    assert format_human(rule, LABELS) == "BB Squeeze AND (Close OR EMA 50)"


def test_format_human_falls_back_to_raw_name():
    assert format_human({"<": [{"var": "xyz"}, 5]}) == "xyz < 5"
