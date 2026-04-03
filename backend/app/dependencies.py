import logging
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase import AuthApiError
from app.database import get_client

logger = logging.getLogger(__name__)
bearer_scheme = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    try:
        response = get_client().auth.get_user(credentials.credentials)
        return response.user
    except AuthApiError as exc:
        logger.warning("Auth rejected: %s", exc.message)
        raise HTTPException(status_code=401, detail=exc.message)


# Future admin check — uncomment and apply to admin-only endpoints when needed:
# def require_admin_role(user = Depends(get_current_user)) -> dict:
#     if user.app_metadata.get("role") != "admin":
#         raise HTTPException(status_code=403, detail="Admin access required")
#     return user
