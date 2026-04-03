import logging
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from jwt import PyJWKClient
from app.config import SUPABASE_URL

logger = logging.getLogger(__name__)
bearer_scheme = HTTPBearer()

# Fetch Supabase's public keys from their JWKS endpoint.
# PyJWKClient caches the keys and handles rotation automatically.
# Supports RS256 (newer Supabase projects) and HS256 (legacy).
_jwks_client = PyJWKClient(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json")


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(credentials.credentials)
        payload = jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=["RS256", "HS256"],
            audience="authenticated",
        )
        return payload
    except jwt.ExpiredSignatureError:
        logger.warning("JWT validation failed: token expired")
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as exc:
        logger.warning("JWT validation failed: %s", type(exc).__name__)
        raise HTTPException(status_code=401, detail="Invalid token")


# Future admin check — uncomment and apply to admin-only endpoints when needed:
# def require_admin_role(user: dict = Depends(get_current_user)) -> dict:
#     if user.get("app_metadata", {}).get("role") != "admin":
#         raise HTTPException(status_code=403, detail="Admin access required")
#     return user
