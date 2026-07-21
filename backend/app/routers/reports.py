import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, Query

from app.services import reports as reports_svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/reports", tags=["reports"])


_IS_SIMULATED_DESC = (
    "true = paper trades only, false = real money only, omit for both combined. "
    "The UI always sends true or false — simulated and real are never blended there."
)


@router.get("/performance")
def get_performance(
    is_simulated: Optional[bool] = Query(None, description=_IS_SIMULATED_DESC),
    date_from: Optional[date] = Query(None),
    date_to:   Optional[date] = Query(None),
):
    """
    Overall performance across closed positions.

    The UI keeps paper and real results strictly separate — it always passes an
    explicit is_simulated. Omitting the param (programmatic/MCP callers) combines
    both; that blended view is deliberately not exposed in the dashboard, because a
    paper trade you'd never have taken averaged with real fills describes no
    strategy anyone ran.
    """
    positions = reports_svc.get_closed_positions(is_simulated, date_from, date_to)

    return {
        "filters": {
            "is_simulated": is_simulated,
            "date_from":    date_from.isoformat() if date_from else None,
            "date_to":      date_to.isoformat()   if date_to   else None,
        },
        "performance":         reports_svc.compute_performance(positions),
        "by_exit_reason":      reports_svc.performance_by_exit_reason(positions),
        "by_signal_score":     reports_svc.performance_by_score(positions),
        "by_normalized_score": reports_svc.performance_by_normalized_score(positions),
    }


@router.get("/by-signal")
def get_performance_by_signal(
    is_simulated: Optional[bool] = Query(None, description=_IS_SIMULATED_DESC),
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
    is_simulated: Optional[bool] = Query(None, description=_IS_SIMULATED_DESC),
    date_from: Optional[date] = Query(None),
    date_to:   Optional[date] = Query(None),
):
    """Cumulative R and P&L after each closed trade, oldest → newest."""
    positions = reports_svc.get_closed_positions(is_simulated, date_from, date_to)
    return {"curve": reports_svc.equity_curve(positions)}
