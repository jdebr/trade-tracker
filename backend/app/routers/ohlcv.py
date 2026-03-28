from fastapi import APIRouter, HTTPException
from app.models.ohlcv import OHLCVFetchRequest, OHLCVFetchResponse
from app.services.ohlcv_cache import bulk_check_freshness, upsert_bars
from app.services.market_data import fetch_ohlcv
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ohlcv", tags=["ohlcv"])


@router.post("/fetch", response_model=OHLCVFetchResponse)
def fetch_ohlcv_bulk(body: OHLCVFetchRequest):
    """
    Ensure OHLCV data is fresh for the requested symbols.

    For each symbol:
    - If cache is fresh: skip API call, add to `cached` list.
    - If cache is stale/empty: fetch from market data API, upsert, add to `fetched`.
    - On error: add to `failed` list (does not abort the whole batch).
    """
    symbols = [s.upper() for s in body.symbols]
    freshness = bulk_check_freshness(symbols)

    fetched: list[str] = []
    cached: list[str] = []
    failed: list[str] = []
    all_bars: list[dict] = []

    for symbol in symbols:
        if freshness.get(symbol):
            cached.append(symbol)
            continue

        try:
            bars = fetch_ohlcv(symbol, body.lookback_days)
            all_bars.extend(bars)
            fetched.append(symbol)
        except Exception as exc:
            logger.error("Failed to fetch OHLCV for %s: %s", symbol, exc)
            failed.append(symbol)

    bars_upserted = upsert_bars(all_bars)

    return OHLCVFetchResponse(
        fetched=fetched,
        cached=cached,
        failed=failed,
        bars_upserted=bars_upserted,
    )
