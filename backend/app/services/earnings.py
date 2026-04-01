"""
Pre-market earnings check — runs Mon–Fri at 8:00 AM ET.

For each watchlist symbol:
  1. Fetch upcoming earnings dates via yfinance Ticker.calendar
  2. If any earnings date falls within EARNINGS_WINDOW_DAYS, fire an
     earnings_approaching alert (deduped per symbol per day)

Public API:
  fetch_earnings_dates(symbol) -> list[date]
  is_earnings_within_days(dates, today, window_days) -> bool
  run_earnings_check() -> dict
"""

import logging
from datetime import date, datetime, timezone

import yfinance as yf

from app.database import get_client
from app.services.scanner import _get_watchlist_symbols

logger = logging.getLogger(__name__)

EARNINGS_WINDOW_DAYS = 5


# ---------------------------------------------------------------------------
# Earnings fetch
# ---------------------------------------------------------------------------

def fetch_earnings_dates(symbol: str) -> list[date]:
    """
    Return upcoming earnings dates for symbol from yfinance.
    Returns [] if no data is available or any error occurs.
    """
    try:
        calendar = yf.Ticker(symbol).calendar
        dates = calendar.get("Earnings Date", [])
        return list(dates) if dates else []
    except Exception as exc:
        logger.warning("Could not fetch earnings calendar for %s: %s", symbol, exc)
        return []


# ---------------------------------------------------------------------------
# Window check
# ---------------------------------------------------------------------------

def is_earnings_within_days(
    dates: list[date],
    today: date,
    window_days: int = EARNINGS_WINDOW_DAYS,
) -> bool:
    """Return True if any earnings date falls within [today, today + window_days]."""
    if not dates:
        return False
    cutoff = today + __import__("datetime").timedelta(days=window_days)
    return any(today <= d <= cutoff for d in dates)


# ---------------------------------------------------------------------------
# Dedup helper
# ---------------------------------------------------------------------------

def _get_existing_earnings_alerts_today(
    symbols: list[str], today: date
) -> set[tuple[str, str]]:
    """Return (symbol, alert_type) pairs already inserted today for earnings alerts."""
    if not symbols:
        return set()
    res = (
        get_client()
        .table("alerts")
        .select("symbol,alert_type")
        .in_("symbol", symbols)
        .eq("date", today.isoformat())
        .execute()
    )
    return {(row["symbol"], row["alert_type"]) for row in res.data}


# ---------------------------------------------------------------------------
# Poll orchestrator
# ---------------------------------------------------------------------------

def run_earnings_check() -> dict:
    """
    Pre-market earnings check pipeline:
      1. Load watchlist symbols
      2. Fetch earnings dates for each (yfinance)
      3. Fire earnings_approaching alert if within EARNINGS_WINDOW_DAYS (deduped)
      4. Insert new alerts

    Returns a summary dict.
    """
    started_at = datetime.now(timezone.utc)
    logger.info("Pre-market earnings check starting")

    symbols = _get_watchlist_symbols()
    if not symbols:
        logger.info("Earnings check: watchlist is empty — skipping")
        return {
            "symbols_checked": 0,
            "alerts_created": 0,
            "alerts_skipped": 0,
            "failed": 0,
            "started_at": started_at.isoformat(),
        }

    today = date.today()
    existing = _get_existing_earnings_alerts_today(symbols, today)

    new_alerts: list[dict] = []
    skipped = 0
    failed = 0

    for symbol in symbols:
        try:
            dates = fetch_earnings_dates(symbol)
        except Exception as exc:
            logger.warning("Earnings fetch failed for %s: %s", symbol, exc)
            failed += 1
            continue

        if not is_earnings_within_days(dates, today=today):
            continue

        if (symbol, "earnings_approaching") in existing:
            skipped += 1
            logger.debug("Earnings alert already exists today for %s — skipping", symbol)
            continue

        nearest = min((d for d in dates if d >= today), default=None)
        new_alerts.append({
            "symbol":           symbol,
            "date":             today.isoformat(),
            "alert_type":       "earnings_approaching",
            "price_at_trigger": None,
            "details":          {"earnings_date": nearest.isoformat() if nearest else None},
            "acknowledged":     False,
        })

    if new_alerts:
        get_client().table("alerts").insert(new_alerts).execute()

    logger.info(
        "Earnings check complete — %d checked, %d alert(s) created, "
        "%d dedup-skipped, %d failed",
        len(symbols), len(new_alerts), skipped, failed,
    )

    return {
        "symbols_checked": len(symbols),
        "alerts_created":  len(new_alerts),
        "alerts_skipped":  skipped,
        "failed":          failed,
        "started_at":      started_at.isoformat(),
    }
