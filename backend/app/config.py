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
