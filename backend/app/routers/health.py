from fastapi import APIRouter
from app.database import get_client

router = APIRouter()


@router.get("/health")
def health_check():
    try:
        get_client().table("watchlist").select("id").limit(1).execute()
        supabase_status = "connected"
    except Exception as e:
        supabase_status = f"error: {e}"

    return {"status": "ok", "supabase": supabase_status}
