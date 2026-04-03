"""
Data refresh pipeline — fetches OHLCV, computes indicators, updates metadata.

Designed to run independently of the screener so that:
  - The screener can be a pure DB rules engine (fast, no API calls)
  - Data can be refreshed on demand (seed endpoint) or on a schedule
  - Fresh symbols are skipped to avoid redundant API calls (idempotent)

Public API:
  fetch_bulk_yfinance(symbols, lookback_days) -> tuple[list[str], list[str]]
  fetch_bulk_with_fallback(symbols, lookback_days) -> tuple[list[str], list[str]]
  run_data_refresh(symbols=None, force=False) -> dict
"""

import logging
from datetime import datetime, timezone

from app.database import get_client
from app.services.indicator_cache import upsert_snapshots
from app.services.indicators import compute_indicators
from app.services.market_data import fetch_from_twelve_data, fetch_from_yfinance
from app.services.ohlcv_cache import bulk_check_freshness
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
# Data refresh
# ---------------------------------------------------------------------------

def run_data_refresh(
    symbols: list[str] | None = None,
    force: bool = False,
) -> dict:
    """
    Fetch OHLCV, compute indicators, and update ticker metadata.

    Steps:
      1. Resolve symbols (use provided list or fetch all non-ETF from tickers table)
      2. Check freshness — skip symbols with up-to-date OHLCV unless force=True
      3. Fetch OHLCV (yfinance primary, Twelve Data fallback) for stale symbols
      4. Compute indicators for all fetched symbols
      5. Update ticker metadata (avg_volume, last_price) for all symbols

    Args:
        symbols: Explicit list of symbols to refresh. If None, uses all tickers.
        force:   If True, skip freshness check and fetch all symbols regardless.

    Returns a summary dict with keys:
        attempted, fetched, skipped_fresh, failed, elapsed_seconds
    """
    started_at = datetime.now(timezone.utc)
    logger.info("Data refresh starting (force=%s)", force)

    all_symbols = symbols if symbols is not None else _get_all_ticker_symbols()

    if not all_symbols:
        logger.error("Data refresh: no symbols to process — is the tickers table populated?")
        return {
            "attempted":     0,
            "fetched":       0,
            "skipped_fresh": 0,
            "failed":        0,
            "elapsed_seconds": 0,
        }

    # Determine which symbols need fetching.
    if force:
        stale_symbols = all_symbols
        skipped_count = 0
        logger.info("Force refresh: fetching all %d symbols", len(stale_symbols))
    else:
        freshness = bulk_check_freshness(all_symbols)
        stale_symbols = [s for s in all_symbols if not freshness.get(s, False)]
        skipped_count = len(all_symbols) - len(stale_symbols)
        logger.info(
            "Freshness check: %d stale, %d fresh (skipping)",
            len(stale_symbols), skipped_count,
        )

    # Fetch OHLCV for stale symbols.
    fetched_symbols: list[str] = []
    failed_symbols:  list[str] = []

    if stale_symbols:
        logger.info("Fetching OHLCV for %d symbols", len(stale_symbols))
        fetched_symbols, failed_symbols = fetch_bulk_with_fallback(stale_symbols)
        logger.info(
            "OHLCV done — %d fetched, %d failed",
            len(fetched_symbols), len(failed_symbols),
        )
    else:
        logger.info("All symbols are fresh — skipping OHLCV fetch")

    # Compute indicators for all symbols (not just fetched) so that symbols with
    # fresh OHLCV but missing snapshots are backfilled. upsert is idempotent.
    snapshots: list[dict] = []
    for symbol in all_symbols:
        try:
            snap = compute_indicators(symbol)
            if snap:
                snapshots.append(snap)
        except Exception as exc:
            logger.warning("Indicator compute failed for %s: %s", symbol, exc)

    rows_upserted = upsert_snapshots(snapshots)
    computed = len(snapshots)
    logger.info("Indicators upserted for %d / %d symbols", computed, len(all_symbols))

    # Update ticker metadata so Pass 1 has fresh avg_volume / last_price.
    try:
        update_ticker_metadata(all_symbols)
    except Exception as exc:
        logger.warning("Metadata update failed: %s", exc)

    finished_at = datetime.now(timezone.utc)
    elapsed = (finished_at - started_at).total_seconds()
    logger.info("Data refresh finished in %.0fs", elapsed)

    return {
        "attempted":       len(all_symbols),
        "fetched":         len(fetched_symbols),
        "skipped_fresh":   skipped_count,
        "failed":          len(failed_symbols),
        "elapsed_seconds": int(elapsed),
    }
