import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, Query

from app.services import reports as reports_svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/performance")
def get_performance(
    is_simulated: Optional[bool] = Query(
        True,
        description=(
            "true = paper trades only (default), false = real money only, "
            "omit with ?is_simulated= to combine both."
        ),
    ),
    date_from: Optional[date] = Query(None),
    date_to:   Optional[date] = Query(None),
):
    """
    Overall performance across closed positions.

    Defaults to SIMULATED trades. Paper and real results are kept apart unless you
    explicitly ask to combine them: blending a paper trade you'd never actually
    have taken with real fills produces a track record that describes no strategy
    anyone ever ran.
    """
    positions = reports_svc.get_closed_positions(is_simulated, date_from, date_to)

    return {
        "filters": {
            "is_simulated": is_simulated,
            "date_from":    date_from.isoformat() if date_from else None,
            "date_to":      date_to.isoformat()   if date_to   else None,
        },
        "performance":       reports_svc.compute_performance(positions),
        "by_exit_reason":    reports_svc.performance_by_exit_reason(positions),
        "by_signal_score":   reports_svc.performance_by_score(positions),
    }


@router.get("/by-signal")
def get_performance_by_signal(
    is_simulated: Optional[bool] = Query(True),
    date_from: Optional[date] = Query(None),
    date_to:   Optional[date] = Query(None),
):
    """
    Which entry signals are actually making money.

    For each signal, compares trades where it fired against trades where it didn't,
    and reports the difference in average R (`edge_r`). This is the evidence base
    for tuning alert conditions.
    """
    positions = reports_svc.get_closed_positions(is_simulated, date_from, date_to)
    return {
        "total_closed_trades": len(positions),
        "signals":             reports_svc.performance_by_signal(positions),
    }


@router.get("/equity-curve")
def get_equity_curve(
    is_simulated: Optional[bool] = Query(True),
    date_from: Optional[date] = Query(None),
    date_to:   Optional[date] = Query(None),
):
    """Cumulative R and P&L after each closed trade, oldest → newest."""
    positions = reports_svc.get_closed_positions(is_simulated, date_from, date_to)
    return {"curve": reports_svc.equity_curve(positions)}
