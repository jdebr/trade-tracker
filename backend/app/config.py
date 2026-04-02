from pathlib import Path
from dotenv import load_dotenv, find_dotenv
import os

# Walk up from this file to find the .env at the repo root
load_dotenv(find_dotenv())

SUPABASE_URL: str = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY: str = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SUPABASE_ANON_KEY: str = os.environ["SUPABASE_ANON_KEY"]
SUPABASE_JWT_SECRET: str = os.getenv("SUPABASE_JWT_SECRET", "")
TWELVE_DATA_API_KEY: str = os.getenv("TWELVE_DATA_API_KEY", "")
ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")

# CORS — comma-separated list of allowed origins
# e.g. "https://my-app.vercel.app,http://localhost:5173"
ALLOWED_ORIGINS: list[str] = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if o.strip()
]

# Scheduler
SCHEDULER_ENABLED: bool = os.getenv("SCHEDULER_ENABLED", "true").lower() == "true"
SCHEDULER_HOUR: int = int(os.getenv("SCHEDULER_HOUR", "16"))
SCHEDULER_MINUTE: int = int(os.getenv("SCHEDULER_MINUTE", "0"))
SCAN_COOLDOWN_MINUTES: int = int(os.getenv("SCAN_COOLDOWN_MINUTES", "60"))
