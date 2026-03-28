from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from app.models.screener import ScreenerRunResponse, ScreenerResultRow, ScreenerCandidate
from app.services.screener import run_screener, get_latest_results, get_results_by_run
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/screener", tags=["screener"])


@router.post("/run", response_model=ScreenerRunResponse)
def trigger_screener_run():
    """
    Run the two-pass screener against the current tickers universe.

    Requires the tickers table to be populated (via universe sync) and
    ohlcv_cache + indicator_snapshots to be fresh (via /ohlcv/fetch and
    /indicators/compute).  Returns the ranked candidate list immediately.
    """
    run_at, candidates = run_screener()

    pass1_count = _get_pass1_count()
    pass2_count = len([c for c in candidates if c["signal_score"] >= 1])

    return ScreenerRunResponse(
        run_at=run_at,
        pass1_count=pass1_count,
        pass2_count=pass2_count,
        candidates=[ScreenerCandidate(**c) for c in candidates],
    )


@router.get("/results", response_model=list[ScreenerResultRow])
def list_screener_results(
    run_at: Optional[str] = Query(None, description="ISO timestamp of a specific run"),
    limit: int = Query(50, ge=1, le=200),
):
    """
    Return screener results.  Without `run_at`, returns the most recent run.
    Pass `run_at` to retrieve a historical run.
    """
    if run_at:
        rows = get_results_by_run(run_at, limit)
    else:
        rows = get_latest_results(limit)

    if not rows:
        raise HTTPException(status_code=404, detail="No screener results found")
    return rows


def _get_pass1_count() -> int:
    """Helper to report Pass 1 count in the response (re-queries tickers)."""
    from app.services.screener import pass1_filter
    return len(pass1_filter())
