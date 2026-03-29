from fastapi import APIRouter, HTTPException, Query
from app.models.alerts import Alert, AlertAcknowledgeResponse, AlertBulkAcknowledgeResponse
from app.database import get_client
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("", response_model=list[Alert])
def list_alerts(
    limit: int = Query(50, ge=1, le=200),
    include_acknowledged: bool = Query(False),
):
    """Return alerts ordered by triggered_at descending."""
    query = (
        get_client()
        .table("alerts")
        .select("*")
        .order("triggered_at", desc=True)
        .limit(limit)
    )
    if not include_acknowledged:
        query = query.eq("acknowledged", False)

    result = query.execute()
    return result.data


@router.patch("/{alert_id}/acknowledge", response_model=AlertAcknowledgeResponse)
def acknowledge_alert(alert_id: str):
    """Mark a single alert as acknowledged."""
    result = (
        get_client()
        .table("alerts")
        .update({"acknowledged": True})
        .eq("id", alert_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail=f"Alert {alert_id} not found")
    row = result.data[0]
    return {"id": row["id"], "acknowledged": row["acknowledged"]}


@router.post("/acknowledge-all", response_model=AlertBulkAcknowledgeResponse)
def acknowledge_all_alerts():
    """Mark all unacknowledged alerts as acknowledged."""
    result = (
        get_client()
        .table("alerts")
        .update({"acknowledged": True})
        .eq("acknowledged", False)
        .execute()
    )
    count = len(result.data) if result.data else 0
    logger.info("Acknowledged %d alerts", count)
    return {"acknowledged_count": count}
