import logging
from fastapi import APIRouter
from app.database import get_client

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
