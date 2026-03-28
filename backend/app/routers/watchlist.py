from fastapi import APIRouter, HTTPException
from app.database import get_client
from app.models.watchlist import WatchlistEntry, WatchlistAdd, WatchlistUpdate
from typing import Optional

router = APIRouter(prefix="/watchlist", tags=["watchlist"])


@router.get("", response_model=list[WatchlistEntry])
def list_watchlist(group: Optional[str] = None):
    query = get_client().table("watchlist").select("*").order("added_at")
    if group:
        query = query.eq("group_name", group)
    result = query.execute()
    return result.data


@router.post("", response_model=WatchlistEntry, status_code=201)
def add_to_watchlist(body: WatchlistAdd):
    result = (
        get_client()
        .table("watchlist")
        .insert(body.model_dump())
        .execute()
    )
    return result.data[0]


@router.patch("/{symbol}", response_model=WatchlistEntry)
def update_watchlist_entry(symbol: str, body: WatchlistUpdate):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = (
        get_client()
        .table("watchlist")
        .update(updates)
        .eq("symbol", symbol.upper())
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail=f"{symbol} not found in watchlist")
    return result.data[0]


@router.delete("/{symbol}", status_code=204)
def remove_from_watchlist(symbol: str):
    result = (
        get_client()
        .table("watchlist")
        .delete()
        .eq("symbol", symbol.upper())
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail=f"{symbol} not found in watchlist")
