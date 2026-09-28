import logging
from fastapi import APIRouter, HTTPException, Path, Query
from app.database import get_client
from app.services.ticker_details import get_ticker_details

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tickers", tags=["tickers"])


@router.get("")
def list_tickers():
    result = (
        get_client()
        .table("tickers")
        .select("symbol,name")
        .eq("is_etf", False)
        .order("symbol")
        .execute()
    )
    return result.data


@router.get("/{symbol}/details")
def ticker_details(
    symbol: str = Path(..., pattern=r"^[A-Za-z0-9.\-]{1,10}$"),
    days: int = Query(10, ge=1, le=40, description="Candles of pattern history to return"),
):
    """
    Everything the ticker details panel shows, in one call: name/sector, latest
    close and change, ~60 bars for a mini chart, candlestick patterns on each of
    the last `days` candles (computed on demand, not stored), the latest
    indicator snapshot, live signal score with per-signal fired/not, and the open
    position (with current R) if there is one.
    """
    details = get_ticker_details(symbol, days)
    if details is None:
        raise HTTPException(status_code=404, detail=f"Unknown symbol: {symbol.upper()}")
    return details
