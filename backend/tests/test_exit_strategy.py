"""
Tests for the exit strategy builder.

Everything here is a pure function of (entry, snapshot, bars, params), so these
run against hand-built fixtures with no database.

The fixture is chosen so the arithmetic is checkable by eye:
    entry     100.00
    atr_14      3.00   → 2x ATR stop = 94.00, risk/share = 6.00
    account 10,000, risk 1% → $100 budget → floor(100 / 6) = 16 shares
    2R target = 100 + (6 * 2) = 112.00
"""

import pytest

from app.services.exit_strategy import (
    MarketContext,
    ExitPlanError,
    build_exit_plan,
    compute_outcome,
    compute_stop_candidates,
    compute_target_candidates,
    compute_trailing_stop,
    size_position,
)
from app.services.settings import DEFAULTS

ENTRY = 100.0

SNAPSHOT = {
    "symbol":     "TEST",
    "date":       "2026-07-10",
    "rsi_14":     50.0,
    "macd_hist":  0.42,
    "bb_upper":   108.0,
    "bb_middle":  100.0,
    "bb_lower":   94.0,
    "bb_width":   0.14,
    "bb_squeeze": True,
    "ema_8":      99.0,
    "ema_21":     96.0,
    "ema_50":     92.0,
    "atr_14":     3.0,
    "obv":        1_000_000,
}

# 10 bars; lowest low is 90.0, highest high is 105.0
BARS = [
    {
        "symbol": "TEST",
        "date":   f"2026-07-{i:02d}",
        "open":   100.0,
        "high":   105.0 if i == 5 else 102.0,
        "low":    90.0 if i == 3 else 97.0,
        "close":  101.0,
        "volume": 2_000_000 if i >= 8 else 1_000_000,   # recent volume expanding
    }
    for i in range(1, 11)
]


@pytest.fixture
def ctx():
    return MarketContext(symbol="TEST", snapshot=SNAPSHOT, bars=BARS)


@pytest.fixture
def settings():
    return dict(DEFAULTS)


# ---------------------------------------------------------------------------
# Stop candidates
# ---------------------------------------------------------------------------

def test_stop_candidates_cover_every_method(ctx):
    stops = compute_stop_candidates(ENTRY, ctx, atr_mult=2.0, stop_pct=8.0, manual_stop=95.0)

    assert stops["atr_multiple"] == pytest.approx(94.0)   # 100 - (3 * 2)
    assert stops["percent"]      == pytest.approx(92.0)   # 100 * (1 - 0.08)
    assert stops["bb_lower"]     == pytest.approx(94.0)
    assert stops["ema_21"]       == pytest.approx(96.0)
    assert stops["ema_50"]       == pytest.approx(92.0)
    assert stops["swing_low"]    == pytest.approx(90.0)   # lowest low in the window
    assert stops["manual"]       == pytest.approx(95.0)


def test_stop_candidates_return_none_when_indicator_missing():
    """A missing indicator yields None, not an exception — the UI greys the option out."""
    bare = MarketContext(symbol="TEST", snapshot={"symbol": "TEST"}, bars=[])
    stops = compute_stop_candidates(ENTRY, bare)

    assert stops["atr_multiple"] is None
    assert stops["bb_lower"]     is None
    assert stops["swing_low"]    is None
    assert stops["percent"]      == pytest.approx(92.0)   # needs no indicator data


def test_atr_multiplier_widens_the_stop(ctx):
    tight = compute_stop_candidates(ENTRY, ctx, atr_mult=1.0)["atr_multiple"]
    wide  = compute_stop_candidates(ENTRY, ctx, atr_mult=3.0)["atr_multiple"]

    assert tight == pytest.approx(97.0)
    assert wide  == pytest.approx(91.0)
    assert wide < tight


# ---------------------------------------------------------------------------
# Target candidates
# ---------------------------------------------------------------------------

def test_r_multiple_target_is_entry_plus_risk_times_r(ctx):
    risk = 6.0
    targets = compute_target_candidates(ENTRY, risk, ctx, target_r=2.0)

    assert targets["r_multiple"] == pytest.approx(112.0)   # 100 + (6 * 2)


def test_target_candidates_cover_every_method(ctx):
    targets = compute_target_candidates(
        ENTRY, 6.0, ctx, target_r=2.0, target_pct=16.0, atr_mult=4.0, manual_target=120.0,
    )

    assert targets["r_multiple"]   == pytest.approx(112.0)
    assert targets["atr_multiple"] == pytest.approx(112.0)  # 100 + (3 * 4)
    assert targets["percent"]      == pytest.approx(116.0)
    assert targets["bb_upper"]     == pytest.approx(108.0)
    assert targets["manual"]       == pytest.approx(120.0)


# ---------------------------------------------------------------------------
# Position sizing
# ---------------------------------------------------------------------------

def test_size_position_risks_a_fixed_fraction_of_the_account():
    shares, risk_amount, position_value = size_position(
        entry_price=100.0, risk_per_share=6.0, account_size=10_000, risk_pct=1.0,
    )
    # $100 budget / $6 per share = 16.67 → floored to 16
    assert shares         == 16
    assert risk_amount    == pytest.approx(96.0)
    assert position_value == pytest.approx(1600.0)


def test_size_position_floors_never_rounds_up():
    """Rounding up would risk more than the budget allows — always floor."""
    shares, risk_amount, _ = size_position(
        entry_price=100.0, risk_per_share=7.0, account_size=10_000, risk_pct=1.0,
    )
    assert shares == 14                       # 100 / 7 = 14.28 → 14, not 15
    assert risk_amount == pytest.approx(98.0)
    assert risk_amount <= 100.0               # never exceeds the budget


def test_tighter_stop_buys_more_shares_for_the_same_dollar_risk():
    """
    The core property of fixed-fractional sizing: stop distance drives share
    count, but dollars at risk stay constant. This is what makes R comparable
    across trades.
    """
    tight_shares, tight_risk, _ = size_position(100.0, 2.0, 10_000, 1.0)
    wide_shares,  wide_risk,  _ = size_position(100.0, 10.0, 10_000, 1.0)

    assert tight_shares == 50
    assert wide_shares  == 10
    assert tight_risk == pytest.approx(100.0)
    assert wide_risk  == pytest.approx(100.0)


# ---------------------------------------------------------------------------
# Full plan
# ---------------------------------------------------------------------------

def test_build_exit_plan_default_path(ctx, settings):
    """Defaults: 2x ATR stop, 2R target, 1% account risk."""
    plan = build_exit_plan("TEST", ENTRY, ctx, settings)

    assert plan.stop_method    == "atr_multiple"
    assert plan.stop_price     == pytest.approx(94.0)
    assert plan.target_method  == "r_multiple"
    assert plan.target_price   == pytest.approx(112.0)
    assert plan.risk_per_share == pytest.approx(6.0)
    assert plan.rr_ratio       == pytest.approx(2.0)
    assert plan.shares         == 16
    assert plan.risk_amount    == pytest.approx(96.0)
    assert plan.position_value == pytest.approx(1600.0)
    assert plan.warnings       == []


def test_build_exit_plan_exposes_all_alternatives(ctx, settings):
    """The builder shows every level side by side, not just the chosen one."""
    plan = build_exit_plan("TEST", ENTRY, ctx, settings)

    assert set(plan.stop_candidates) == {
        "atr_multiple", "percent", "bb_lower", "ema_21", "ema_50", "swing_low", "manual",
    }
    assert set(plan.target_candidates) == {
        "r_multiple", "atr_multiple", "percent", "bb_upper", "manual",
    }
    assert plan.stop_candidates["swing_low"] == pytest.approx(90.0)


def test_overrides_beat_settings_defaults(ctx, settings):
    plan = build_exit_plan(
        "TEST", ENTRY, ctx, settings,
        stop_method="percent", stop_pct=10.0,
        target_method="bb_upper",
        account_size=50_000, risk_pct=2.0,
    )

    assert plan.stop_price     == pytest.approx(90.0)    # 100 * (1 - 0.10)
    assert plan.risk_per_share == pytest.approx(10.0)
    assert plan.target_price   == pytest.approx(108.0)   # bb_upper
    # $50k * 2% = $1,000 budget / $10 per share = 100 shares
    assert plan.shares         == 100


def test_plan_persists_its_full_parameter_set(ctx, settings):
    """params is stored on the position so a plan can be reconstructed later."""
    plan = build_exit_plan("TEST", ENTRY, ctx, settings, atr_mult=2.5)

    assert plan.params["stop_method"]     == "atr_multiple"
    assert plan.params["atr_mult"]        == 2.5
    assert plan.params["atr_14_at_entry"] == pytest.approx(3.0)


# ---------------------------------------------------------------------------
# Guard rails
# ---------------------------------------------------------------------------

def test_stop_above_entry_is_a_hard_error(ctx, settings):
    """
    Not a warning. With a stop above entry there is no risk to divide by, so
    R-multiple, share count, and R:R are all meaningless.
    """
    with pytest.raises(ExitPlanError, match="must be below the entry price"):
        build_exit_plan("TEST", ENTRY, ctx, settings, stop_method="manual", manual_stop=105.0)


def test_stop_equal_to_entry_is_a_hard_error(ctx, settings):
    with pytest.raises(ExitPlanError, match="must be below the entry price"):
        build_exit_plan("TEST", ENTRY, ctx, settings, stop_method="manual", manual_stop=100.0)


def test_missing_indicator_for_chosen_stop_method_raises(settings):
    bare = MarketContext(symbol="TEST", snapshot={"symbol": "TEST"}, bars=[])

    with pytest.raises(ExitPlanError, match="required indicator data is missing"):
        build_exit_plan("TEST", ENTRY, bare, settings, stop_method="atr_multiple")


def test_unknown_method_raises(ctx, settings):
    with pytest.raises(ExitPlanError, match="Unknown stop method"):
        build_exit_plan("TEST", ENTRY, ctx, settings, stop_method="astrology")


def test_short_positions_are_rejected_in_v1(ctx, settings):
    with pytest.raises(ExitPlanError, match="Only long positions"):
        build_exit_plan("TEST", ENTRY, ctx, settings, direction="short")


# ---------------------------------------------------------------------------
# Warnings (advisory — the plan still builds)
# ---------------------------------------------------------------------------

def test_warns_when_reward_to_risk_is_too_low(ctx, settings):
    # bb_upper target (108) against a 2x ATR stop (94) → R:R = 8/6 = 1.33
    plan = build_exit_plan("TEST", ENTRY, ctx, settings, target_method="bb_upper")

    assert plan.rr_ratio == pytest.approx(1.333, abs=0.01)
    assert any("Reward-to-risk" in w for w in plan.warnings)


def test_warns_when_risk_budget_is_too_small_to_buy_a_share(ctx, settings):
    settings["account_size"] = 100.0     # $1 of risk budget at 1%
    plan = build_exit_plan("TEST", ENTRY, ctx, settings)

    assert plan.shares == 0
    assert any("0 shares" in w for w in plan.warnings)


def test_warns_on_an_unusually_wide_stop(ctx, settings):
    plan = build_exit_plan("TEST", ENTRY, ctx, settings, stop_method="manual", manual_stop=80.0)

    assert any("unusually wide" in w for w in plan.warnings)


def test_warns_when_position_exceeds_the_concentration_limit(ctx, settings):
    # A very tight stop buys a lot of shares — enough to blow past 25% of account.
    settings["risk_per_trade_pct"] = 5.0
    plan = build_exit_plan("TEST", ENTRY, ctx, settings, stop_method="manual", manual_stop=99.5)

    assert plan.position_pct_of_account > 25.0
    assert any("concentration limit" in w for w in plan.warnings)


def test_a_valid_plan_produces_no_warnings(ctx, settings):
    assert build_exit_plan("TEST", ENTRY, ctx, settings).warnings == []


# ---------------------------------------------------------------------------
# Trailing stop
# ---------------------------------------------------------------------------

def test_trailing_stop_moves_up_when_price_makes_a_new_high():
    # Highest high 110, ATR 3, 3x multiplier → 110 - 9 = 101
    new_stop = compute_trailing_stop(current_stop=94.0, highest_high=110.0, atr=3.0, trail_atr_mult=3.0)
    assert new_stop == pytest.approx(101.0)


def test_trailing_stop_never_moves_down():
    """
    The ratchet invariant. A trailing stop that could loosen would let a winner
    give back more than the original risk — which defeats the whole purpose.
    """
    # Candidate would be 100 - 9 = 91, below the current stop of 94.
    assert compute_trailing_stop(current_stop=94.0, highest_high=100.0, atr=3.0, trail_atr_mult=3.0) is None


def test_trailing_stop_returns_none_when_unchanged():
    # Candidate lands exactly on the current stop — not an improvement.
    assert compute_trailing_stop(current_stop=101.0, highest_high=110.0, atr=3.0, trail_atr_mult=3.0) is None


# ---------------------------------------------------------------------------
# Outcome maths
# ---------------------------------------------------------------------------

def test_outcome_of_a_winner_hitting_its_2r_target():
    outcome = compute_outcome(entry_price=100.0, exit_price=112.0, shares=16, initial_stop_price=94.0)

    assert outcome["pnl"]        == pytest.approx(192.0)   # 12 * 16
    assert outcome["pnl_pct"]    == pytest.approx(12.0)
    assert outcome["r_multiple"] == pytest.approx(2.0)     # 12 / 6


def test_outcome_of_a_loser_stopped_out_is_minus_one_r():
    outcome = compute_outcome(entry_price=100.0, exit_price=94.0, shares=16, initial_stop_price=94.0)

    assert outcome["pnl"]        == pytest.approx(-96.0)
    assert outcome["r_multiple"] == pytest.approx(-1.0)


def test_r_multiple_is_measured_against_the_initial_stop_not_the_trailed_one():
    """
    A trade that trailed its stop up to 105 and exited at 112 still risked 6/share
    at entry, so it is a 2R win — not a 7x win. Measuring against the trailed stop
    would flatter every winner.
    """
    outcome = compute_outcome(entry_price=100.0, exit_price=112.0, shares=16, initial_stop_price=94.0)
    assert outcome["r_multiple"] == pytest.approx(2.0)
