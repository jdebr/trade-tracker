import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from app.models.screener import ScreenerCandidate, ScreenerRunResponse, ScreenerResultRow
from app.services import screener_job as jobs
from app.services.prefetch import run_data_refresh
from app.services.screener import (
    get_latest_results,
    get_results_by_run,
    pass1_filter,
    run_screener,
)
from app.services.universe import sync_universe, update_ticker_metadata

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


async def _run_data_refresh_job(job_id: str, force: bool) -> None:
    """Run data refresh in a thread and update job state on completion."""
    jobs.set_running(job_id)
    try:
        summary = await asyncio.to_thread(lambda: run_data_refresh(force=force))
        jobs.set_done(job_id, summary)
        logger.info("Data refresh job %s done: %s", job_id, summary)
    except Exception as exc:
        logger.error("Data refresh job %s failed: %s", job_id, exc, exc_info=True)
        jobs.set_error(job_id, str(exc))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/sync-universe", status_code=200)
async def sync_universe_endpoint():
    """
    Sync the S&P 500 universe into the tickers table and update metadata
    (avg_volume, last_price) from cached OHLCV data.
    Run this once on a fresh database before using the screener.
    """
    count = await asyncio.to_thread(sync_universe)
    from app.database import get_client
    symbols_result = get_client().table("tickers").select("symbol").execute()
    symbols = [r["symbol"] for r in symbols_result.data]
    await asyncio.to_thread(lambda: update_ticker_metadata(symbols))
    logger.info("Universe sync complete — %d tickers upserted", count)
    return {"tickers_upserted": count}


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


@router.post("/refresh-data", status_code=202)
async def trigger_data_refresh(
    background_tasks: BackgroundTasks,
    force: bool = Query(False, description="Fetch all symbols even if cache is fresh"),
):
    """
    Start an async data refresh job (OHLCV fetch → indicators → metadata).

    Use this to seed the database on first deploy or to force a refresh outside
    the Saturday schedule.  Pass ?force=true to bypass freshness checks.

    Poll GET /screener/job/{job_id} until status is "done" or "error".
    Typical run time: several minutes for a full 500-symbol refresh.
    """
    job_id = jobs.create_job()
    background_tasks.add_task(_run_data_refresh_job, job_id, force)
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
