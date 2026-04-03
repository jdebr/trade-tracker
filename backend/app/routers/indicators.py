import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from app.database import get_client
from app.models.indicators import IndicatorComputeRequest, IndicatorComputeResponse, IndicatorSnapshot
from app.services import screener_job as jobs
from app.services.indicator_cache import get_indicator_history, get_latest_snapshots, upsert_snapshots
from app.services.indicators import compute_indicators

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/indicators", tags=["indicators"])


# ---------------------------------------------------------------------------
# Background worker
# ---------------------------------------------------------------------------

def _compute_all(symbols: list[str]) -> IndicatorComputeResponse:
    """Compute indicators for a list of symbols and upsert results."""
    computed: list[str] = []
    skipped: list[str] = []
    failed: list[str] = []
    snapshots: list[dict] = []

    for symbol in symbols:
        try:
            snap = compute_indicators(symbol.upper())
            if snap is None:
                skipped.append(symbol.upper())
            else:
                snapshots.append(snap)
                computed.append(symbol.upper())
        except Exception as exc:
            logger.error("Failed to compute indicators for %s: %s", symbol, exc)
            failed.append(symbol.upper())

    rows_upserted = upsert_snapshots(snapshots)
    return IndicatorComputeResponse(
        computed=computed,
        skipped=skipped,
        failed=failed,
        rows_upserted=rows_upserted,
    )


async def _run_compute_job(job_id: str, symbols: list[str]) -> None:
    """Run indicator compute in a thread and update job state on completion."""
    jobs.set_running(job_id)
    try:
        result = await asyncio.to_thread(_compute_all, symbols)
        jobs.set_done(job_id, result.model_dump())
        logger.info(
            "Indicator compute job %s done — %d computed, %d skipped, %d failed",
            job_id, len(result.computed), len(result.skipped), len(result.failed),
        )
    except Exception as exc:
        logger.error("Indicator compute job %s failed: %s", job_id, exc, exc_info=True)
        jobs.set_error(job_id, str(exc))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/snapshots", response_model=list[IndicatorSnapshot])
def get_snapshots(
    symbols: str = Query(..., description="Comma-separated list of ticker symbols"),
):
    """
    Return the most-recent indicator snapshot for each requested symbol.
    Pass symbols as a comma-separated query param: ?symbols=AAPL,MSFT,NVDA
    """
    sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    return get_latest_snapshots(sym_list)


@router.get("/history", response_model=list[IndicatorSnapshot])
def get_history(
    symbol: str = Query(..., description="Ticker symbol"),
    limit:  int = Query(252, ge=1, le=504),
):
    """Return indicator history for a symbol (for chart overlays), oldest → newest."""
    return get_indicator_history(symbol.upper(), limit=limit)


@router.post("/compute", status_code=202)
async def compute_indicators_bulk(
    background_tasks: BackgroundTasks,
    body: IndicatorComputeRequest = IndicatorComputeRequest(symbols=[]),
    all_symbols: bool = Query(False, description="Compute for all non-ETF tickers (ignores body.symbols)"),
):
    """
    Start an async indicator compute job and return immediately with a job_id.
    Poll GET /screener/job/{job_id} until status is "done" or "error".

    Pass ?all_symbols=true to compute for all non-ETF tickers in the universe.
    Otherwise, provide a list of symbols in the request body.

    Typical run time: 30–90 seconds for the full S&P 500 universe.
    """
    if all_symbols:
        result = get_client().table("tickers").select("symbol").eq("is_etf", False).execute()
        symbols = [r["symbol"] for r in result.data]
        logger.info("Indicator compute job queued for all %d tickers", len(symbols))
    else:
        symbols = body.symbols

    if not symbols:
        raise HTTPException(status_code=422, detail="No symbols provided. Pass ?all_symbols=true or include symbols in the request body.")

    job_id = jobs.create_job()
    background_tasks.add_task(_run_compute_job, job_id, symbols)
    return {"job_id": job_id, "status": jobs.JOB_STATUS_PENDING, "symbol_count": len(symbols)}
