"""
Tests for performance reporting.

The metric definitions are standard trade-journal arithmetic, so the fixtures are
built to be checkable by hand. Expectancy and profit factor especially are easy to
get subtly wrong (sign errors on average loss; divide-by-zero when there are no
losers), so both have dedicated tests.

Base fixture — 5 closed trades:
    +$200 (+2R), −$100 (−1R), +$300 (+3R), −$100 (−1R), +$100 (+1R)

    wins 3, losses 2         → win rate 60%
    gross profit $600, gross loss $200 → profit factor 3.0
    avg win $200, avg loss $100
    expectancy = (0.6 × 200) − (0.4 × 100) = 120 − 40 = $80
    total R = +4R, avg R = +0.8R
"""

import pytest

from app.services.reports import (
    compute_performance,
    equity_curve,
    performance_by_exit_reason,
    performance_by_normalized_score,
    performance_by_score,
    performance_by_signal,
)


def _pos(pnl, r, signals=None, exit_reason="manual", exit_date="2026-07-01", hold_days=5):
    # Boolean signal flags live under entry_signals["signals"] (the dynamic set);
    # scalar keys like signal_score / signal_score_normalized stay top-level.
    signals = signals or {}
    flags   = {k: v for k, v in signals.items() if isinstance(v, bool)}
    scalars = {k: v for k, v in signals.items() if not isinstance(v, bool)}
    return {
        "symbol":        "TEST",
        "pnl":           pnl,
        "r_multiple":    r,
        "hold_days":     hold_days,
        "exit_reason":   exit_reason,
        "exit_date":     exit_date,
        "entry_signals": {"signals": flags, **scalars},
    }


TRADES = [
    _pos(200, 2.0,  exit_date="2026-07-01"),
    _pos(-100, -1.0, exit_date="2026-07-02"),
    _pos(300, 3.0,  exit_date="2026-07-03"),
    _pos(-100, -1.0, exit_date="2026-07-04"),
    _pos(100, 1.0,  exit_date="2026-07-05"),
]


# ---------------------------------------------------------------------------
# Aggregate metrics
# ---------------------------------------------------------------------------

def test_headline_metrics():
    perf = compute_performance(TRADES)

    assert perf["total_trades"] == 5
    assert perf["wins"]         == 3
    assert perf["losses"]       == 2
    assert perf["win_rate"]     == 60.0
    assert perf["total_pnl"]    == 400.0
    assert perf["avg_win"]      == 200.0
    assert perf["avg_loss"]     == 100.0     # magnitude, not signed
    assert perf["largest_win"]  == 300.0
    assert perf["largest_loss"] == -100.0


def test_profit_factor_is_gross_profit_over_gross_loss():
    # 600 / 200
    assert compute_performance(TRADES)["profit_factor"] == 3.0


def test_expectancy():
    # (0.6 x 200) - (0.4 x 100) = 80
    assert compute_performance(TRADES)["expectancy"] == 80.0


def test_expectancy_is_negative_when_losses_outweigh_a_high_win_rate():
    """
    The case expectancy exists to catch: winning 80% of the time and still losing
    money, because the one loss is bigger than the four wins combined.
    """
    trades = [
        _pos(50, 0.5), _pos(50, 0.5), _pos(50, 0.5), _pos(50, 0.5),
        _pos(-500, -5.0),
    ]
    perf = compute_performance(trades)

    assert perf["win_rate"] == 80.0          # looks great
    assert perf["total_pnl"] == -300.0       # but loses money
    # (0.8 x 50) - (0.2 x 500) = 40 - 100 = -60
    assert perf["expectancy"] == -60.0


def test_r_multiple_totals():
    perf = compute_performance(TRADES)
    assert perf["total_r"] == 4.0
    assert perf["avg_r"]   == 0.8


def test_consecutive_streaks():
    trades = [
        _pos(100, 1.0), _pos(100, 1.0), _pos(100, 1.0),   # 3 wins
        _pos(-100, -1.0), _pos(-100, -1.0),               # 2 losses
        _pos(100, 1.0),
    ]
    perf = compute_performance(trades)

    assert perf["max_consecutive_wins"]   == 3
    assert perf["max_consecutive_losses"] == 2


def test_max_drawdown_measures_the_deepest_peak_to_trough_decline():
    # Cumulative R: 3, 2, 1, 0, 2 → peak 3, trough 0 → drawdown 3R
    trades = [
        _pos(300, 3.0), _pos(-100, -1.0), _pos(-100, -1.0),
        _pos(-100, -1.0), _pos(200, 2.0),
    ]
    assert compute_performance(trades)["max_drawdown_r"] == 3.0


def test_avg_hold_days():
    trades = [_pos(100, 1.0, hold_days=4), _pos(100, 1.0, hold_days=6)]
    assert compute_performance(trades)["avg_hold_days"] == 5.0


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

def test_no_trades_returns_a_zeroed_report_rather_than_crashing():
    perf = compute_performance([])

    assert perf["total_trades"] == 0
    assert perf["win_rate"]     is None
    assert perf["expectancy"]   is None
    assert perf["total_pnl"]    == 0.0
    assert perf["sample_is_thin"] is True


def test_profit_factor_is_none_when_there_are_no_losses():
    """
    Dividing by zero gross loss would be infinity. Reporting None is honest;
    a huge number would imply a precision we don't have.
    """
    perf = compute_performance([_pos(100, 1.0), _pos(200, 2.0)])

    assert perf["profit_factor"] is None
    assert perf["win_rate"]      == 100.0
    assert perf["expectancy"]    == 150.0    # all wins: 1.0 x 150


def test_all_losses():
    perf = compute_performance([_pos(-100, -1.0), _pos(-200, -2.0)])

    assert perf["win_rate"]      == 0.0
    assert perf["profit_factor"] == 0.0      # gross profit 0 / gross loss 300
    assert perf["expectancy"]    == -150.0
    assert perf["avg_win"]       is None


def test_thin_sample_is_flagged():
    assert compute_performance(TRADES)["sample_is_thin"] is True
    assert compute_performance([_pos(100, 1.0)] * 25)["sample_is_thin"] is False


# ---------------------------------------------------------------------------
# Signal attribution — the point of the feature
# ---------------------------------------------------------------------------

def test_by_signal_computes_the_edge_between_with_and_without():
    """
    BB squeeze trades average +2R; non-squeeze trades average −1R.
    The edge is +3R — clear evidence the signal is doing work.
    """
    trades = [
        _pos(200, 2.0,  {"bb_squeeze": True,  "rsi_in_range": False}),
        _pos(200, 2.0,  {"bb_squeeze": True,  "rsi_in_range": False}),
        _pos(-100, -1.0, {"bb_squeeze": False, "rsi_in_range": False}),
        _pos(-100, -1.0, {"bb_squeeze": False, "rsi_in_range": False}),
    ]

    rows = performance_by_signal(trades)
    squeeze = next(r for r in rows if r["signal"] == "bb_squeeze")

    assert squeeze["with_signal"]["trades"]    == 2
    assert squeeze["with_signal"]["avg_r"]     == 2.0
    assert squeeze["without_signal"]["trades"] == 2
    assert squeeze["without_signal"]["avg_r"]  == -1.0
    assert squeeze["edge_r"]                   == 3.0


def test_by_signal_detects_a_signal_that_is_actively_losing_money():
    """A negative edge is the finding that matters — it says stop using this."""
    trades = [
        _pos(-200, -2.0, {"volume_expansion": True}),
        _pos(-200, -2.0, {"volume_expansion": True}),
        _pos(100, 1.0,  {"volume_expansion": False}),
        _pos(100, 1.0,  {"volume_expansion": False}),
    ]

    rows = performance_by_signal(trades)
    vol = next(r for r in rows if r["signal"] == "volume_expansion")

    assert vol["edge_r"] == -3.0     # -2R with, +1R without


def test_by_signal_edge_is_none_when_one_side_has_no_trades():
    """Can't compare against a group that doesn't exist — don't invent a number."""
    trades = [_pos(200, 2.0, {"bb_squeeze": True})]

    squeeze = next(r for r in performance_by_signal(trades) if r["signal"] == "bb_squeeze")

    assert squeeze["with_signal"]["trades"]    == 1
    assert squeeze["without_signal"]["trades"] == 0
    assert squeeze["edge_r"]      is None
    assert squeeze["sample_is_thin"] is True


def test_by_signal_covers_every_signal_and_ranks_by_edge():
    trades = [
        _pos(300, 3.0,  {"bb_squeeze": True,  "rsi_in_range": False,
                         "above_ema50": True, "volume_expansion": False}),
        _pos(-100, -1.0, {"bb_squeeze": False, "rsi_in_range": True,
                          "above_ema50": False, "volume_expansion": True}),
    ]

    rows = performance_by_signal(trades)

    assert {r["signal"] for r in rows} == {
        "bb_squeeze", "rsi_in_range", "above_ema50", "volume_expansion",
    }
    # Strongest edge first.
    edges = [r["edge_r"] for r in rows if r["edge_r"] is not None]
    assert edges == sorted(edges, reverse=True)


def test_by_score_groups_trades_by_entry_signal_score():
    trades = [
        _pos(300, 3.0,  {"signal_score": 4}),
        _pos(100, 1.0,  {"signal_score": 4}),
        _pos(-100, -1.0, {"signal_score": 1}),
    ]

    rows = performance_by_score(trades)
    by_score = {r["signal_score"]: r for r in rows}

    assert by_score[4]["trades"] == 2
    assert by_score[4]["avg_r"]  == 2.0
    assert by_score[1]["trades"] == 1
    assert by_score[1]["avg_r"]  == -1.0


# ---------------------------------------------------------------------------
# Exit reason
# ---------------------------------------------------------------------------

def test_by_exit_reason_groups_and_sorts_by_frequency():
    trades = [
        _pos(200, 2.0,  exit_reason="target_hit"),
        _pos(200, 2.0,  exit_reason="target_hit"),
        _pos(-100, -1.0, exit_reason="stop_hit"),
    ]

    rows = performance_by_exit_reason(trades)

    assert rows[0]["exit_reason"] == "target_hit"    # most frequent first
    assert rows[0]["trades"]      == 2
    assert rows[0]["avg_r"]       == 2.0
    assert rows[1]["exit_reason"] == "stop_hit"
    assert rows[1]["total_pnl"]   == -100.0


# ---------------------------------------------------------------------------
# Equity curve
# ---------------------------------------------------------------------------

def test_equity_curve_accumulates_r_and_pnl_in_order():
    curve = equity_curve(TRADES)

    assert len(curve) == 5
    assert [p["cumulative_r"] for p in curve] == [2.0, 1.0, 4.0, 3.0, 4.0]
    assert [p["cumulative_pnl"] for p in curve] == [200.0, 100.0, 400.0, 300.0, 400.0]


def test_equity_curve_of_no_trades_is_empty():
    assert equity_curve([]) == []


# ---------------------------------------------------------------------------
# M19: dynamic signals + normalized-score reporting
# ---------------------------------------------------------------------------

def test_by_signal_handles_a_user_defined_slug():
    # Signals are no longer a fixed four — a custom slug must be reported too.
    trades = [
        _pos(100, 1.0, {"my_signal": True}),
        _pos(-50, -0.5, {"my_signal": False}),
    ]
    slugs = {r["signal"] for r in performance_by_signal(trades)}
    assert "my_signal" in slugs


def test_by_normalized_score_buckets_by_band():
    trades = [
        _pos(100, 1.0,  {"signal_score_normalized": 0.9}),
        _pos(200, 2.0,  {"signal_score_normalized": 0.85}),
        _pos(-50, -0.5, {"signal_score_normalized": 0.1}),
        _pos(300, 3.0,  {"signal_score_normalized": 1.0}),   # perfect lands in the top band
    ]
    bands = {r["band"]: r for r in performance_by_normalized_score(trades)}
    assert bands["0.8–1.0"]["trades"] == 3
    assert bands["0.0–0.2"]["trades"] == 1


def test_by_normalized_score_ignores_positions_without_a_normalized_score():
    assert performance_by_normalized_score([_pos(100, 1.0, {"bb_squeeze": True})]) == []


def test_by_signal_reads_legacy_flat_entry_signals():
    # A position opened before M19a stored signal bools flat (no nested "signals").
    def _legacy(pnl, r, flat_signals):
        return {
            "symbol": "OLD", "pnl": pnl, "r_multiple": r, "hold_days": 5,
            "exit_reason": "manual", "exit_date": "2026-07-01",
            "entry_signals": flat_signals,
        }
    trades = [
        _legacy(100, 1.0, {"bb_squeeze": True, "signal_score": 1}),
        _legacy(-50, -0.5, {"bb_squeeze": False, "signal_score": 0}),
    ]
    squeeze = next(r for r in performance_by_signal(trades) if r["signal"] == "bb_squeeze")
    assert squeeze["with_signal"]["trades"] == 1
    assert squeeze["without_signal"]["trades"] == 1
