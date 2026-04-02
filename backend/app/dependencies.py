import base64
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from app.config import SUPABASE_JWT_SECRET

bearer_scheme = HTTPBearer()

# Supabase stores the JWT secret base64-encoded in the dashboard.
# PyJWT needs the raw bytes to verify the signature.
_jwt_secret = base64.b64decode(SUPABASE_JWT_SECRET) if SUPABASE_JWT_SECRET else ""


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    try:
        payload = jwt.decode(
            credentials.credentials,
            _jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# Future admin check — uncomment and apply to admin-only endpoints when needed:
# def require_admin_role(user: dict = Depends(get_current_user)) -> dict:
#     if user.get("app_metadata", {}).get("role") != "admin":
#         raise HTTPException(status_code=403, detail="Admin access required")
#     return user
