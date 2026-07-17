from pathlib import Path
from dotenv import load_dotenv, find_dotenv
import os

# Walk up from this file to find the .env at the repo root
load_dotenv(find_dotenv())

SUPABASE_URL: str = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY: str = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SUPABASE_ANON_KEY: str = os.environ["SUPABASE_ANON_KEY"]
TWELVE_DATA_API_KEY: str = os.getenv("TWELVE_DATA_API_KEY", "")
ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")

# CORS — comma-separated list of allowed origins
# e.g. "https://my-app.vercel.app,http://localhost:5173"
ALLOWED_ORIGINS: list[str] = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if o.strip()
]

# Outside production, always allow the local Vite dev origins even when
# ALLOWED_ORIGINS is set to the production URL only. Without this, a repo .env
# carrying the deployed origin leaves local dev with no CORS header, and the
# browser reports every response (including 4xx) as a CORS failure.
if ENVIRONMENT != "production":
    for _dev_origin in ("http://localhost:5173", "http://127.0.0.1:5173"):
        if _dev_origin not in ALLOWED_ORIGINS:
            ALLOWED_ORIGINS.append(_dev_origin)

# Scheduler
SCHEDULER_ENABLED: bool = os.getenv("SCHEDULER_ENABLED", "true").lower() == "true"
SCHEDULER_HOUR: int = int(os.getenv("SCHEDULER_HOUR", "16"))
SCHEDULER_MINUTE: int = int(os.getenv("SCHEDULER_MINUTE", "0"))
SCAN_COOLDOWN_MINUTES: int = int(os.getenv("SCAN_COOLDOWN_MINUTES", "60"))
