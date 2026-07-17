from fastapi import APIRouter, HTTPException, Query
from app.services import scheduler as svc

router = APIRouter(prefix="/scheduler", tags=["scheduler"])


@router.get("/status")
async def get_status():
    """Return current scheduler state: enabled, paused, next run, last result."""
    return svc.get_status()


@router.post("/trigger")
async def trigger():
    """
    Manually trigger a watchlist scan immediately.
    Returns 429 if the cooldown window has not yet expired, or if paused.
    """
    success, message, result = await svc.trigger_now()
    if not success:
        raise HTTPException(status_code=429, detail=message)
    return {
        "message": message,
        "result":  result.to_dict() if result else None,
    }


@router.post("/cleanup")
async def cleanup():
    """
    Manually run the storage retention cleanup immediately.
    Prunes the re-derivable caches (OHLCV / indicators, 18-month window) and
    stale alerts (90-day window). Trade records and screener history are never
    touched. Returns a per-table count of rows deleted.
    """
    summary = await svc.trigger_cleanup()
    return {"message": "Cleanup completed", "deleted": summary}


@router.post("/pause")
async def pause(
    hours: float = Query(
        24.0,
        ge=0.5,
        le=168.0,
        description="How many hours to pause the scheduler (0.5–168)",
    )
):
    """
    Suspend the scheduled job for the given number of hours.
    The pause is in-memory and resets on server restart.
    Manual triggers via POST /scheduler/trigger are also blocked while paused.
    """
    pause_until = svc.pause(hours)
    return {"paused_until": pause_until.isoformat(), "hours": hours}


@router.post("/resume")
async def resume():
    """Clear any active pause and resume the normal schedule immediately."""
    svc.resume()
    return {"message": "Scheduler resumed"}
