"""
Saturday universe prefetch job.

Fetches OHLCV for all S&P 500 tickers, computes indicators, updates ticker
metadata, and runs the screener — so results are ready Sunday morning.

Strategy:
  - yfinance for bulk fetch (free, no API credits)
  - Twelve Data fallback for any yfinance failures (uses daily credit budget)
  - Indicator compute failures are logged and skipped — don't abort the job

Public API:
  fetch_bulk_yfinance(symbols) -> tuple[list[str], list[str]]
  fetch_bulk_with_fallback(symbols) -> tuple[list[str], list[str]]
  run_prefetch_job() -> dict
"""

import logging
from datetime import datetime, timezone

from app.database import get_client
from app.services.indicators import compute_indicators
from app.services.market_data import fetch_from_twelve_data, fetch_from_yfinance
from app.services.screener import run_screener
from app.services.universe import update_ticker_metadata

logger = logging.getLogger(__name__)

DEFAULT_LOOKBACK = 100


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_all_ticker_symbols() -> list[str]:
    """Return all non-ETF symbols from the tickers table."""
    result = (
        get_client()
        .table("tickers")
        .select("symbol")
        .eq("is_etf", False)
        .execute()
    )
    return [r["symbol"] for r in result.data]


# ---------------------------------------------------------------------------
# Bulk fetch
# ---------------------------------------------------------------------------

def fetch_bulk_yfinance(
    symbols: list[str],
    lookback_days: int = DEFAULT_LOOKBACK,
) -> tuple[list[str], list[str]]:
    """
    Fetch OHLCV for each symbol via yfinance and upsert into ohlcv_cache.

    Returns:
        (successes, failures) — lists of symbol strings
    """
    from app.services.ohlcv_cache import upsert_bars as _upsert_bars

    successes, failures = [], []
    for symbol in symbols:
        try:
            bars = fetch_from_yfinance(symbol, lookback_days=lookback_days)
            _upsert_bars(bars)
            successes.append(symbol)
        except Exception as exc:
            logger.warning("yfinance fetch failed for %s: %s", symbol, exc)
            failures.append(symbol)
    return successes, failures


def fetch_bulk_with_fallback(
    symbols: list[str],
    lookback_days: int = DEFAULT_LOOKBACK,
) -> tuple[list[str], list[str]]:
    """
    Fetch OHLCV for all symbols using yfinance; retry failures with Twelve Data.

    Returns:
        (successes, failures) — failures contains only symbols that failed both sources
    """
    from app.services.ohlcv_cache import upsert_bars as _upsert_bars

    yf_successes, yf_failures = fetch_bulk_yfinance(symbols, lookback_days=lookback_days)

    successes = list(yf_successes)
    failures = []

    if yf_failures:
        logger.info(
            "yfinance failed for %d symbols — retrying with Twelve Data: %s",
            len(yf_failures),
            yf_failures,
        )
        for symbol in yf_failures:
            try:
                bars = fetch_from_twelve_data(symbol, lookback_days=lookback_days)
                _upsert_bars(bars)
                successes.append(symbol)
                logger.info("Twelve Data fallback OK for %s", symbol)
            except Exception as exc:
                logger.warning("Twelve Data fallback also failed for %s: %s", symbol, exc)
                failures.append(symbol)

    return successes, failures


# ---------------------------------------------------------------------------
# Prefetch job
# ---------------------------------------------------------------------------

def run_prefetch_job() -> dict:
    """
    Full Saturday prefetch pipeline:
      1. Get all ticker symbols from DB
      2. Fetch OHLCV (yfinance + TD fallback)
      3. Compute indicators for all successfully fetched tickers
      4. Update ticker metadata (avg_volume, last_price)
      5. Run two-pass screener and save results

    Returns a summary dict.
    """
    started_at = datetime.now(timezone.utc)
    logger.info("Universe prefetch job starting")

    symbols = _get_all_ticker_symbols()
    if not symbols:
        logger.error("Prefetch job: tickers table is empty — run sync-universe first")
        return {
            "tickers_attempted": 0,
            "fetched": 0,
            "failed": 0,
            "screener_candidates": 0,
            "started_at": started_at.isoformat(),
        }

    logger.info("Prefetch: fetching OHLCV for %d tickers", len(symbols))
    fetched_symbols, failed_symbols = fetch_bulk_with_fallback(symbols)
    logger.info(
        "Prefetch: OHLCV done — %d fetched, %d failed",
        len(fetched_symbols), len(failed_symbols),
    )

    # Compute indicators — skip individual failures, don't abort
    computed = 0
    for symbol in fetched_symbols:
        try:
            compute_indicators(symbol)
            computed += 1
        except Exception as exc:
            logger.warning("Indicator compute failed for %s: %s", symbol, exc)

    logger.info("Prefetch: indicators computed for %d tickers", computed)

    # Update ticker metadata so Pass 1 filters have fresh avg_volume / last_price
    try:
        update_ticker_metadata(fetched_symbols)
    except Exception as exc:
        logger.warning("Metadata update failed: %s", exc)

    # Run screener — results saved to screener_results table
    candidates = []
    try:
        _, candidates = run_screener()
        logger.info("Prefetch: screener complete — %d candidates", len(candidates))
    except Exception as exc:
        logger.error("Prefetch: screener failed: %s", exc, exc_info=True)

    finished_at = datetime.now(timezone.utc)
    elapsed = (finished_at - started_at).total_seconds()
    logger.info("Universe prefetch job finished in %.0fs", elapsed)

    return {
        "tickers_attempted": len(symbols),
        "fetched": len(fetched_symbols),
        "failed": len(failed_symbols),
        "screener_candidates": len(candidates),
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "elapsed_seconds": int(elapsed),
    }
