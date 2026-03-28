"""
Stock universe management.

Loads the S&P 500 constituent list and syncs it into the `tickers` table.
Also updates per-ticker metadata (avg_volume, last_price) from ohlcv_cache
so that Pass 1 filtering can run without any API calls.

Public API:
    load_sp500_symbols() -> list[dict]   # fetch from Wikipedia or static CSV
    sync_universe()      -> int          # upsert into tickers; returns row count
    update_ticker_metadata(symbols)      # update avg_volume + last_price from cache
"""

import logging
import os
from pathlib import Path
import pandas as pd
from app.database import get_client

logger = logging.getLogger(__name__)

_STATIC_CSV = Path(__file__).parent.parent.parent / "data" / "sp500.csv"
_WIKIPEDIA_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"


def load_sp500_symbols() -> list[dict]:
    """
    Return a list of dicts with keys: symbol, name, sector, is_etf.

    Tries Wikipedia first (live, authoritative); falls back to the bundled
    static CSV if the network request fails.
    """
    try:
        tables = pd.read_html(_WIKIPEDIA_URL, attrs={"id": "constituents"})
        df = tables[0]
        # Wikipedia columns: Symbol, Security, GICS Sector, ...
        df = df.rename(columns={
            "Symbol":      "symbol",
            "Security":    "name",
            "GICS Sector": "sector",
        })
        df["symbol"] = df["symbol"].str.replace(".", "-", regex=False)  # BRK.B → BRK-B (yfinance convention)
        df["is_etf"] = False
        result = df[["symbol", "name", "sector", "is_etf"]].to_dict(orient="records")
        logger.info("Loaded %d symbols from Wikipedia", len(result))
        _refresh_static_csv(df[["symbol", "name", "sector", "is_etf"]])
        return result
    except Exception as exc:
        logger.warning("Wikipedia fetch failed (%s) — using static CSV", exc)

    df = pd.read_csv(_STATIC_CSV)
    df["is_etf"] = df["is_etf"].astype(str).str.lower() == "true"
    result = df[["symbol", "name", "sector", "is_etf"]].to_dict(orient="records")
    logger.info("Loaded %d symbols from static CSV", len(result))
    return result


def _refresh_static_csv(df: pd.DataFrame) -> None:
    """Overwrite the bundled CSV with the latest Wikipedia data."""
    try:
        df.to_csv(_STATIC_CSV, index=False)
        logger.info("Refreshed static CSV fallback (%d symbols)", len(df))
    except Exception as exc:
        logger.warning("Could not refresh static CSV: %s", exc)


def sync_universe() -> int:
    """
    Upsert all S&P 500 symbols into the `tickers` table.
    Sets in_sp500=True for all rows loaded.
    Returns the number of rows upserted.
    """
    rows = load_sp500_symbols()
    for row in rows:
        row["in_sp500"] = True

    # Upsert in chunks to avoid Supabase request-size limits.
    chunk_size = 100
    total = 0
    for i in range(0, len(rows), chunk_size):
        chunk = rows[i : i + chunk_size]
        result = (
            get_client()
            .table("tickers")
            .upsert(chunk, on_conflict="symbol")
            .execute()
        )
        total += len(result.data) if result.data else 0

    logger.info("Synced %d tickers to universe", total)
    return total


def update_ticker_metadata(symbols: list[str]) -> None:
    """
    For each symbol, read recent ohlcv_cache bars and update:
      - last_price  = most recent close
      - avg_volume  = mean of last 20 days' volume

    Only updates rows that already exist in `tickers`.
    Skips symbols with no cached OHLCV data.
    """
    for symbol in symbols:
        result = (
            get_client()
            .table("ohlcv_cache")
            .select("close,volume")
            .eq("symbol", symbol)
            .order("date", desc=True)
            .limit(20)
            .execute()
        )
        bars = result.data
        if not bars:
            continue

        last_price = float(bars[0]["close"])
        avg_volume = int(sum(b["volume"] for b in bars) / len(bars))

        get_client().table("tickers").update({
            "last_price": last_price,
            "avg_volume": avg_volume,
        }).eq("symbol", symbol).execute()

    logger.info("Updated metadata for %d tickers", len(symbols))
