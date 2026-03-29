from fastapi import APIRouter, Query
from typing import Optional
from app.models.indicators import IndicatorComputeRequest, IndicatorComputeResponse, IndicatorSnapshot
from app.services.indicators import compute_indicators
from app.services.indicator_cache import upsert_snapshots, get_latest_snapshots, get_indicator_history
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/indicators", tags=["indicators"])


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


@router.post("/compute", response_model=IndicatorComputeResponse)
def compute_indicators_bulk(body: IndicatorComputeRequest):
    """
    Compute indicator snapshots for the requested symbols using cached OHLCV
    data, then upsert results into indicator_snapshots.

    Symbols with insufficient OHLCV history are placed in `skipped`.
    Symbols that raise an unexpected error are placed in `failed`.
    """
    computed: list[str] = []
    skipped: list[str] = []
    failed: list[str] = []
    snapshots: list[dict] = []

    for symbol in body.symbols:
        try:
            snapshot = compute_indicators(symbol.upper())
            if snapshot is None:
                skipped.append(symbol.upper())
            else:
                snapshots.append(snapshot)
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
