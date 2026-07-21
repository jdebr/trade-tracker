import logging
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import ALLOWED_ORIGINS, ENVIRONMENT
from app.dependencies import get_current_user
from app.routers import (
    health, watchlist, ohlcv, indicators, screener, alerts, scheduler,
    tickers, status, positions, settings, reports, rules, signal_rules,
)
from app.services.scheduler import start_scheduler, stop_scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Trade Tracker API", version="0.1.0", lifespan=lifespan)

# In development, allow any localhost port so a Vite fallback port (5174, etc.)
# still works without reconfiguring. Production uses the explicit origin list only.
_dev_origin_regex = (
    r"http://(localhost|127\.0\.0\.1):\d+" if ENVIRONMENT != "production" else None
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=_dev_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(status.router)
app.include_router(watchlist.router,   dependencies=[Depends(get_current_user)])
app.include_router(ohlcv.router,       dependencies=[Depends(get_current_user)])
app.include_router(indicators.router,  dependencies=[Depends(get_current_user)])
app.include_router(screener.router,    dependencies=[Depends(get_current_user)])
app.include_router(alerts.router,      dependencies=[Depends(get_current_user)])
app.include_router(scheduler.router,   dependencies=[Depends(get_current_user)])
app.include_router(tickers.router,     dependencies=[Depends(get_current_user)])
app.include_router(positions.router,   dependencies=[Depends(get_current_user)])
app.include_router(settings.router,    dependencies=[Depends(get_current_user)])
app.include_router(reports.router,     dependencies=[Depends(get_current_user)])
app.include_router(rules.router,       dependencies=[Depends(get_current_user)])
app.include_router(signal_rules.router, dependencies=[Depends(get_current_user)])
