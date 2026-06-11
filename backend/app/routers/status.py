from fastapi import APIRouter
from app.database import get_client
from app.services import scheduler as sched_svc

router = APIRouter(prefix="/status", tags=["status"])


@router.get("/summary")
async def get_summary():
    """
    Public read-only status snapshot — no auth required.
    Returns scheduler state, alert count, watchlist size, and top screener results.
    """
    db = get_client()

    # Scheduler state (includes API usage, last/next run)
    scheduler = sched_svc.get_status()

    # Unacknowledged alert count
    alert_res = (
        db.table("alerts")
        .select("id", count="exact")
        .eq("acknowledged", False)
        .execute()
    )
    unacknowledged_alerts = alert_res.count or 0

    # Watchlist size
    watchlist_res = (
        db.table("watchlist")
        .select("symbol", count="exact")
        .execute()
    )
    watchlist_size = watchlist_res.count or 0

    # Top screener results from the most recent run
    screener_res = (
        db.table("screener_results")
        .select("symbol,signal_score,bb_squeeze,rsi_in_range,above_ema50,volume_expansion,run_at")
        .order("run_at", desc=True)
        .order("signal_score", desc=True)
        .limit(5)
        .execute()
    )
    top_candidates = screener_res.data or []

    return {
        "scheduler": {
            "enabled": scheduler.get("enabled"),
            "paused": scheduler.get("paused"),
            "pause_until": scheduler.get("pause_until"),
            "last_run_at": scheduler.get("last_run_at"),
            "next_run": scheduler.get("next_run"),
            "schedule": scheduler.get("schedule"),
            "last_run_result": scheduler.get("last_run_result"),
            "td_api_usage": scheduler.get("td_api_usage"),
        },
        "unacknowledged_alerts": unacknowledged_alerts,
        "watchlist_size": watchlist_size,
        "top_screener_candidates": top_candidates,
    }
