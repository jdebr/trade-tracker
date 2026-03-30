import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from app.models.screener import ScreenerCandidate, ScreenerRunResponse, ScreenerResultRow
from app.services import screener_job as jobs
from app.services.screener import (
    get_latest_results,
    get_results_by_run,
    pass1_filter,
    run_screener,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/screener", tags=["screener"])


# ---------------------------------------------------------------------------
# Background worker
# ---------------------------------------------------------------------------

async def _run_screener_job(job_id: str) -> None:
    """Run the screener in a thread and update job state on completion."""
    jobs.set_running(job_id)
    try:
        run_at, candidates = await asyncio.to_thread(run_screener)
        pass1_count = await asyncio.to_thread(lambda: len(pass1_filter()))
        pass2_count = len([c for c in candidates if c["signal_score"] >= 1])
        jobs.set_done(job_id, {
            "run_at":      run_at.isoformat(),
            "pass1_count": pass1_count,
            "pass2_count": pass2_count,
            "candidates":  candidates,
        })
        logger.info("Screener job %s done — %d candidates", job_id, len(candidates))
    except Exception as exc:
        logger.error("Screener job %s failed: %s", job_id, exc, exc_info=True)
        jobs.set_error(job_id, str(exc))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/run", status_code=202)
async def trigger_screener_run(background_tasks: BackgroundTasks):
    """
    Start an async screener run and return immediately with a job_id.
    Poll GET /screener/job/{job_id} until status is "done" or "error".
    Typical run time: 30–90 seconds with a cold cache.
    """
    job_id = jobs.create_job()
    background_tasks.add_task(_run_screener_job, job_id)
    return {"job_id": job_id, "status": jobs.JOB_STATUS_PENDING}


@router.get("/job/{job_id}")
async def get_screener_job(job_id: str):
    """
    Poll screener job status.

    status values:
      pending  — queued, not yet started
      running  — in progress
      done     — completed; result contains run_at, pass1_count, pass2_count, candidates
      error    — failed; error contains the message
    """
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=404,
            detail=f"Job {job_id} not found. Jobs are stored in memory and reset on server restart.",
        )
    return job


@router.get("/results", response_model=list[ScreenerResultRow])
def list_screener_results(
    run_at: Optional[str] = Query(None, description="ISO timestamp of a specific run"),
    limit:  int           = Query(50, ge=1, le=200),
):
    """
    Return screener results. Without `run_at`, returns the most recent run.
    Pass `run_at` to retrieve a historical run.
    """
    if run_at:
        rows = get_results_by_run(run_at, limit)
    else:
        rows = get_latest_results(limit)

    if not rows:
        raise HTTPException(status_code=404, detail="No screener results found")
    return rows
