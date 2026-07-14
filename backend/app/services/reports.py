"""
Performance reporting over closed positions.

Every metric here is standard trade-journal arithmetic — win rate, profit factor,
expectancy, R-multiples. Nothing is invented; the definitions are the ones used
across trading journals so the numbers mean what a trader expects them to mean.

The important one is **expectancy**: the average amount you can expect to make per
trade over a large sample.

    expectancy = (win_rate x avg_win) - (loss_rate x avg_loss)

A strategy can win 70% of the time and still lose money if the losses are big
enough; expectancy is what catches that.

**Signal attribution** (`performance_by_signal`) is the payoff of the whole
feature. Each position stores the indicator flags that were true at entry, so we
can split closed trades by signal and compare average R with the flag on versus
off. That difference is the evidence for keeping, dropping, or retuning a signal.

Public API:
    compute_performance(positions) -> dict
    performance_by_signal(positions) -> list[dict]
    equity_curve(positions) -> list[dict]
    get_closed_positions(is_simulated, date_from, date_to) -> list[dict]
"""

import logging
from datetime import date

from app.database import get_client

logger = logging.getLogger(__name__)

# The four screener signals recorded on every position at entry.
SIGNAL_FLAGS = ("bb_squeeze", "rsi_in_range", "above_ema50", "volume_expansion")

# Below this many trades, metrics are noise rather than signal. Surfaced to the
# UI so it can caveat the numbers rather than presenting them as fact.
MIN_SAMPLE_SIZE = 20


# ---------------------------------------------------------------------------
# Query
# ---------------------------------------------------------------------------

def get_closed_positions(
    is_simulated: bool | None = None,
    date_from:    date | None = None,
    date_to:      date | None = None,
) -> list[dict]:
    """
    Closed positions, oldest → newest by exit date.

    `is_simulated=None` returns both paper and real trades combined. That is
    almost never what you want for judging a strategy — see the note in
    routers/reports.py — so callers must opt into it explicitly.
    """
    query = (
        get_client()
        .table("positions")
        .select("*")
        .eq("status", "closed")
    )
    if is_simulated is not None:
        query = query.eq("is_simulated", is_simulated)
    if date_from is not None:
        query = query.gte("exit_date", date_from.isoformat())
    if date_to is not None:
        query = query.lte("exit_date", date_to.isoformat())

    return query.order("exit_date").execute().data


# ---------------------------------------------------------------------------
# Aggregate metrics
# ---------------------------------------------------------------------------

def _empty_performance() -> dict:
    return {
        "total_trades": 0, "wins": 0, "losses": 0, "breakeven": 0,
        "win_rate": None, "total_pnl": 0.0, "avg_win": None, "avg_loss": None,
        "profit_factor": None, "expectancy": None,
        "total_r": 0.0, "avg_r": None,
        "largest_win": None, "largest_loss": None,
        "avg_hold_days": None,
        "max_consecutive_wins": 0, "max_consecutive_losses": 0,
        "max_drawdown_r": 0.0,
        "sample_is_thin": True,
    }


def compute_performance(positions: list[dict]) -> dict:
    """Aggregate performance metrics across a set of closed positions."""
    if not positions:
        return _empty_performance()

    pnls = [float(p["pnl"]) for p in positions if p.get("pnl") is not None]
    rs   = [float(p["r_multiple"]) for p in positions if p.get("r_multiple") is not None]
    holds = [int(p["hold_days"]) for p in positions if p.get("hold_days") is not None]

    if not pnls:
        return _empty_performance()

    wins      = [p for p in pnls if p > 0]
    losses    = [p for p in pnls if p < 0]
    breakeven = [p for p in pnls if p == 0]

    total   = len(pnls)
    win_rate = len(wins) / total

    avg_win  = sum(wins) / len(wins) if wins else None
    # Kept POSITIVE — the magnitude of the average loss. The expectancy formula
    # subtracts it, so a signed value here would flip the sign and silently
    # invert the result.
    avg_loss = abs(sum(losses) / len(losses)) if losses else None

    gross_profit = sum(wins)
    gross_loss   = abs(sum(losses))
    # A run with no losses has no finite profit factor. Reporting it as None is
    # honest; reporting it as a huge number implies a precision we don't have.
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else None

    expectancy = (
        (win_rate * avg_win) - ((1 - win_rate) * avg_loss)
        if avg_win is not None and avg_loss is not None
        else (win_rate * avg_win) if avg_win is not None
        else -((1 - win_rate) * avg_loss) if avg_loss is not None
        else None
    )

    max_win_streak = max_loss_streak = win_streak = loss_streak = 0
    for pnl in pnls:
        if pnl > 0:
            win_streak += 1
            loss_streak = 0
            max_win_streak = max(max_win_streak, win_streak)
        elif pnl < 0:
            loss_streak += 1
            win_streak = 0
            max_loss_streak = max(max_loss_streak, loss_streak)
        else:
            win_streak = loss_streak = 0

    return {
        "total_trades": total,
        "wins":         len(wins),
        "losses":       len(losses),
        "breakeven":    len(breakeven),
        "win_rate":     round(win_rate * 100, 2),
        "total_pnl":    round(sum(pnls), 2),
        "avg_win":      round(avg_win, 2) if avg_win is not None else None,
        "avg_loss":     round(avg_loss, 2) if avg_loss is not None else None,
        "profit_factor": round(profit_factor, 2) if profit_factor is not None else None,
        "expectancy":   round(expectancy, 2) if expectancy is not None else None,
        "total_r":      round(sum(rs), 2) if rs else 0.0,
        "avg_r":        round(sum(rs) / len(rs), 2) if rs else None,
        "largest_win":  round(max(pnls), 2),
        "largest_loss": round(min(pnls), 2),
        "avg_hold_days": round(sum(holds) / len(holds), 1) if holds else None,
        "max_consecutive_wins":   max_win_streak,
        "max_consecutive_losses": max_loss_streak,
        "max_drawdown_r":         _max_drawdown_r(rs),
        # A caveat, not a metric — tells the UI to warn instead of asserting.
        "sample_is_thin": total < MIN_SAMPLE_SIZE,
    }


def _max_drawdown_r(r_multiples: list[float]) -> float:
    """
    Largest peak-to-trough decline of the cumulative R curve.

    Measured in R rather than dollars so it stays comparable as the account size
    changes over time.
    """
    if not r_multiples:
        return 0.0

    cumulative = peak = 0.0
    max_dd = 0.0
    for r in r_multiples:
        cumulative += r
        peak = max(peak, cumulative)
        max_dd = max(max_dd, peak - cumulative)
    return round(max_dd, 2)


# ---------------------------------------------------------------------------
# Signal attribution — the point of the whole exercise
# ---------------------------------------------------------------------------

def performance_by_signal(positions: list[dict]) -> list[dict]:
    """
    For each entry signal, compare trades where it was true against trades where
    it was false.

    `edge_r` is the difference in average R between the two groups. A clearly
    positive edge is evidence the signal is worth keeping; a negative one is
    evidence it is actively costing money. Either way, this is the number that
    feeds alert-condition tuning.

    Both groups' sample sizes come back with the numbers, because an "edge" drawn
    from three trades is not an edge.
    """
    rows = []

    for flag in SIGNAL_FLAGS:
        with_flag    = [p for p in positions if (p.get("entry_signals") or {}).get(flag) is True]
        without_flag = [p for p in positions if (p.get("entry_signals") or {}).get(flag) is False]

        with_perf    = compute_performance(with_flag)
        without_perf = compute_performance(without_flag)

        edge = (
            round(with_perf["avg_r"] - without_perf["avg_r"], 2)
            if with_perf["avg_r"] is not None and without_perf["avg_r"] is not None
            else None
        )

        rows.append({
            "signal": flag,
            "with_signal": {
                "trades":   with_perf["total_trades"],
                "win_rate": with_perf["win_rate"],
                "avg_r":    with_perf["avg_r"],
                "total_r":  with_perf["total_r"],
                "expectancy": with_perf["expectancy"],
            },
            "without_signal": {
                "trades":   without_perf["total_trades"],
                "win_rate": without_perf["win_rate"],
                "avg_r":    without_perf["avg_r"],
                "total_r":  without_perf["total_r"],
                "expectancy": without_perf["expectancy"],
            },
            "edge_r": edge,
            "sample_is_thin": (
                with_perf["total_trades"] < MIN_SAMPLE_SIZE
                or without_perf["total_trades"] < MIN_SAMPLE_SIZE
            ),
        })

    # Strongest edge first — but a None edge (one side has no trades) sorts last.
    rows.sort(key=lambda r: (r["edge_r"] is None, -(r["edge_r"] or 0)))
    return rows


def performance_by_score(positions: list[dict]) -> list[dict]:
    """
    Performance grouped by the 0–4 signal score the screener assigned at entry.

    If the scoring model works, average R should climb with the score. If it
    doesn't, the score is not measuring what we hoped.
    """
    rows = []
    for score in range(5):
        group = [
            p for p in positions
            if (p.get("entry_signals") or {}).get("signal_score") == score
        ]
        if not group:
            continue
        perf = compute_performance(group)
        rows.append({
            "signal_score": score,
            "trades":       perf["total_trades"],
            "win_rate":     perf["win_rate"],
            "avg_r":        perf["avg_r"],
            "total_r":      perf["total_r"],
        })
    return rows


def performance_by_exit_reason(positions: list[dict]) -> list[dict]:
    """
    Performance grouped by how the trade ended.

    Mostly a discipline check: if manual exits consistently underperform the
    planned stop and target exits, the plan is working and the discretion isn't.
    """
    reasons: dict[str, list[dict]] = {}
    for p in positions:
        reasons.setdefault(p.get("exit_reason") or "unknown", []).append(p)

    rows = []
    for reason, group in reasons.items():
        perf = compute_performance(group)
        rows.append({
            "exit_reason": reason,
            "trades":      perf["total_trades"],
            "win_rate":    perf["win_rate"],
            "avg_r":       perf["avg_r"],
            "total_r":     perf["total_r"],
            "total_pnl":   perf["total_pnl"],
        })
    rows.sort(key=lambda r: -r["trades"])
    return rows


# ---------------------------------------------------------------------------
# Equity curve
# ---------------------------------------------------------------------------

def equity_curve(positions: list[dict]) -> list[dict]:
    """
    Cumulative R and cumulative P&L after each closed trade, oldest → newest.

    Positions are expected to arrive sorted by exit_date (get_closed_positions
    does this) — the running totals depend on that order.
    """
    curve = []
    cum_r = cum_pnl = 0.0

    for p in positions:
        r   = float(p["r_multiple"]) if p.get("r_multiple") is not None else 0.0
        pnl = float(p["pnl"])        if p.get("pnl")        is not None else 0.0
        cum_r   += r
        cum_pnl += pnl

        curve.append({
            "exit_date":      str(p["exit_date"]),
            "symbol":         p["symbol"],
            "r_multiple":     round(r, 2),
            "pnl":            round(pnl, 2),
            "cumulative_r":   round(cum_r, 2),
            "cumulative_pnl": round(cum_pnl, 2),
        })

    return curve
