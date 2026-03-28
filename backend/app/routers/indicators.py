from fastapi import APIRouter
from app.models.indicators import IndicatorComputeRequest, IndicatorComputeResponse
from app.services.indicators import compute_indicators
from app.services.indicator_cache import upsert_snapshots
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/indicators", tags=["indicators"])


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
