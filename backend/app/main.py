import logging
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import ALLOWED_ORIGINS
from app.dependencies import get_current_user
from app.routers import health, watchlist, ohlcv, indicators, screener, alerts, scheduler
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(watchlist.router,   dependencies=[Depends(get_current_user)])
app.include_router(ohlcv.router,       dependencies=[Depends(get_current_user)])
app.include_router(indicators.router,  dependencies=[Depends(get_current_user)])
app.include_router(screener.router,    dependencies=[Depends(get_current_user)])
app.include_router(alerts.router,      dependencies=[Depends(get_current_user)])
app.include_router(scheduler.router,   dependencies=[Depends(get_current_user)])
