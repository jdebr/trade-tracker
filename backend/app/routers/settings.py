import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from app.models.settings import Settings, SettingsUpdate
from app.services import settings as settings_svc
from app.services.exit_strategy import STOP_METHODS, TARGET_METHODS

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=Settings)
def get_settings():
    """Return the position-sizing and exit-plan defaults."""
    return settings_svc.get_settings()


@router.patch("", response_model=Settings)
def update_settings(body: SettingsUpdate):
    """Partially update the defaults. Only the fields supplied are changed."""
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    if "default_stop_method" in updates and updates["default_stop_method"] not in STOP_METHODS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown stop method. Valid options: {', '.join(STOP_METHODS)}",
        )
    if "default_target_method" in updates and updates["default_target_method"] not in TARGET_METHODS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown target method. Valid options: {', '.join(TARGET_METHODS)}",
        )

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    try:
        return settings_svc.update_settings(updates)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
