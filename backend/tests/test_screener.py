"""
Tests for Milestone 5: two-pass screener.

Testing criteria:
1. Pass 1 reduces ~500 tickers to ~150–200 (here: seeded set → correct subset)
2. Pass 2 produces a ranked list of candidates scored 0–4
3. Results are persisted in screener_results and retrievable via GET
4. Run completes in under 2 minutes (with warm cache)
"""

import time
import pytest
from datetime import datetime, timezone, date, timedelta
from app.database import get_client
from app.services.screener import (
    pass1_filter,
    pass2_score,
    save_results,
    get_latest_results,
    run_screener,
)

# -------------------------------------------------------------------------
# Test fixtures — synthetic ticker + OHLCV + indicator data
# -------------------------------------------------------------------------

# 10 test symbols; some will pass Pass 1, some won't.
TEST_SYMBOLS = [
    "SCR_A",  # passes P1 and all P2 signals  → score 4
    "SCR_B",  # passes P1, 2 P2 signals       → score 2
    "SCR_C",  # passes P1, 0 P2 signals       → score 0
    "SCR_D",  # fails P1: price too low ($5)
    "SCR_E",  # fails P1: price too high ($600)
    "SCR_F",  # fails P1: volume too low
    "SCR_G",  # fails P1: is_etf = True
    "SCR_H",  # passes P1, score 1            → score 1
    "SCR_I",  # passes P1, no indicator snap  → excluded from P2
    "SCR_J",  # passes P1, score 3            → score 3
]

# Tickers metadata (determines Pass 1 outcome)
TICKER_ROWS = [
    {"symbol": "SCR_A", "name": "Test A", "sector": "Technology", "is_etf": False, "in_sp500": True, "avg_volume": 5_000_000, "last_price": 150.0},
    {"symbol": "SCR_B", "name": "Test B", "sector": "Financials",  "is_etf": False, "in_sp500": True, "avg_volume": 2_000_000, "last_price": 80.0},
    {"symbol": "SCR_C", "name": "Test C", "sector": "Health Care", "is_etf": False, "in_sp500": True, "avg_volume": 1_500_000, "last_price": 200.0},
    {"symbol": "SCR_D", "name": "Test D", "sector": "Energy",      "is_etf": False, "in_sp500": True, "avg_volume": 3_000_000, "last_price": 5.0},    # price < 15
    {"symbol": "SCR_E", "name": "Test E", "sector": "Energy",      "is_etf": False, "in_sp500": True, "avg_volume": 3_000_000, "last_price": 600.0},  # price > 500
    {"symbol": "SCR_F", "name": "Test F", "sector": "Utilities",   "is_etf": False, "in_sp500": True, "avg_volume": 500_000,   "last_price": 50.0},   # vol < 1M
    {"symbol": "SCR_G", "name": "Test G", "sector": "None",        "is_etf": True,  "in_sp500": True, "avg_volume": 5_000_000, "last_price": 300.0},  # ETF
    {"symbol": "SCR_H", "name": "Test H", "sector": "Industrials", "is_etf": False, "in_sp500": True, "avg_volume": 1_200_000, "last_price": 75.0},
    {"symbol": "SCR_I", "name": "Test I", "sector": "Materials",   "is_etf": False, "in_sp500": True, "avg_volume": 2_500_000, "last_price": 120.0},
    {"symbol": "SCR_J", "name": "Test J", "sector": "Consumer",    "is_etf": False, "in_sp500": True, "avg_volume": 3_000_000, "last_price": 90.0},
]

# Expected Pass 1 survivors (by symbol)
PASS1_EXPECTED = {"SCR_A", "SCR_B", "SCR_C", "SCR_H", "SCR_I", "SCR_J"}

# Indicator snapshots for Pass 2 (SCR_I intentionally omitted → no snapshot)
TODAY = date.today().isoformat()
SNAP_ROWS = [
    # SCR_A: all signals True → score 4
    {"symbol": "SCR_A", "date": TODAY, "rsi_14": 50.0,  "bb_squeeze": True,  "ema_50": 140.0},
    # SCR_B: bb_squeeze + rsi_in_range → score 2
    {"symbol": "SCR_B", "date": TODAY, "rsi_14": 45.0,  "bb_squeeze": True,  "ema_50": 90.0},   # above_ema50=False (80<90), vol_exp set below
    # SCR_C: no signals → score 0
    {"symbol": "SCR_C", "date": TODAY, "rsi_14": 75.0,  "bb_squeeze": False, "ema_50": 180.0},
    # SCR_H: only above_ema50 → score 1
    {"symbol": "SCR_H", "date": TODAY, "rsi_14": 25.0,  "bb_squeeze": False, "ema_50": 70.0},
    # SCR_J: bb_squeeze + rsi_in_range + above_ema50 → score 3
    {"symbol": "SCR_J", "date": TODAY, "rsi_14": 60.0,  "bb_squeeze": True,  "ema_50": 80.0},
]

# OHLCV — last_close and volume for volume_expansion check
# volume_expansion = avg(last 3d) > avg(last 20d)
def _make_ohlcv_rows(symbol: str, last_close: float, vol_expanding: bool):
    """
    20 bars: first 17 with low volume (1M), last 3 with high volume (3M) if
    vol_expanding=True, otherwise flat at 1M.
    """
    rows = []
    start = date.today() - timedelta(days=19)
    for i in range(20):
        bar_date = start + timedelta(days=i)
        vol = 3_000_000 if (vol_expanding and i >= 17) else 1_000_000
        rows.append({
            "symbol":  symbol,
            "date":    bar_date.isoformat(),
            "open":    last_close,
            "high":    last_close * 1.005,
            "low":     last_close * 0.995,
            "close":   last_close,
            "volume":  vol,
            "source":  "yfinance",
        })
    return rows


# SCR_A: close=150 > ema=140 (above_ema50=True), vol_expanding=True → +2 → total 4
# SCR_B: close=80  < ema=90  (above_ema50=False), vol_expanding=False → +0 → total 2
# SCR_C: close=200 > ema=180 (above_ema50=True, but rsi/bb fail) → +1... wait
# Let me recalculate:
#   SCR_C: rsi=75 (out of range), bb=False, above_ema=True(200>180), vol_exp=False → score=1 (not 0)
# Let me make SCR_C's close below ema_50 too, or make vol_exp False to keep score 0.
# Actually: SCR_C: close=200, ema=180 → above_ema=True (+1) but rsi=75 (out of range, +0), bb=False (+0), vol_exp=False (+0) → score=1
# That's not 0. Let me adjust the snap row to make ema_50=210 (close below ema) AND vol_exp=False → score=0
# I'll override in the fixture below.

OHLCV_FIXTURE = (
    _make_ohlcv_rows("SCR_A", last_close=150.0, vol_expanding=True)   # above ema(140)=True, vol_exp=True
  + _make_ohlcv_rows("SCR_B", last_close=80.0,  vol_expanding=False)  # above ema(90)=False, vol_exp=False → score 2 (bb+rsi)
  + _make_ohlcv_rows("SCR_C", last_close=200.0, vol_expanding=False)  # ema=210 (below), vol_exp=False → score 0
  + _make_ohlcv_rows("SCR_H", last_close=75.0,  vol_expanding=False)  # above ema(70)=True, vol_exp=False → score 1
  + _make_ohlcv_rows("SCR_I", last_close=120.0, vol_expanding=False)  # no indicator snap → excluded
  + _make_ohlcv_rows("SCR_J", last_close=90.0,  vol_expanding=False)  # above ema(80)=True, vol_exp=False → score 3
)

# Correct SCR_C ema_50 to be above close (so above_ema50=False)
SNAP_ROWS_FIXED = [
    r if r["symbol"] != "SCR_C" else {**r, "ema_50": 210.0}
    for r in SNAP_ROWS
]


def _cleanup():
    db = get_client()
    for sym in TEST_SYMBOLS:
        db.table("screener_results").delete().eq("symbol", sym).execute()
        db.table("indicator_snapshots").delete().eq("symbol", sym).execute()
        db.table("ohlcv_cache").delete().eq("symbol", sym).execute()
        db.table("tickers").delete().eq("symbol", sym).execute()


def _seed():
    db = get_client()
    # Insert tickers (no FK deps for test symbols)
    db.table("tickers").upsert(TICKER_ROWS, on_conflict="symbol").execute()

    # Insert indicator snapshots
    db.table("indicator_snapshots").upsert(SNAP_ROWS_FIXED, on_conflict="symbol,date").execute()

    # Insert OHLCV (chunked)
    chunk = 50
    for i in range(0, len(OHLCV_FIXTURE), chunk):
        db.table("ohlcv_cache").upsert(
            OHLCV_FIXTURE[i:i+chunk], on_conflict="symbol,date"
        ).execute()


# -------------------------------------------------------------------------
# Criterion 1: Pass 1 filters correctly
# -------------------------------------------------------------------------

def test_pass1_filters_correctly():
    """
    6 of the 10 test tickers should survive Pass 1.
    SCR_D (price too low), SCR_E (price too high), SCR_F (vol too low),
    SCR_G (is_etf=True) must be excluded.
    """
    _cleanup()
    _seed()

    survivors = set(pass1_filter())
    # All expected symbols must be in survivors
    assert PASS1_EXPECTED.issubset(survivors), (
        f"Missing from Pass 1: {PASS1_EXPECTED - survivors}"
    )
    # Disqualified symbols must NOT be in survivors
    disqualified = {"SCR_D", "SCR_E", "SCR_F", "SCR_G"}
    assert not disqualified.intersection(survivors), (
        f"Should have been filtered: {disqualified.intersection(survivors)}"
    )

    _cleanup()


# -------------------------------------------------------------------------
# Criterion 2: Pass 2 produces a correctly scored ranked list
# -------------------------------------------------------------------------

def test_pass2_scores_and_ranks_correctly():
    """
    Expected scores for Pass 1 survivors:
      SCR_A → 4 (all signals)
      SCR_J → 3 (bb, rsi, above_ema)
      SCR_B → 2 (bb, rsi)
      SCR_H → 1 (above_ema only)
      SCR_C → 0 (no signals)
      SCR_I → excluded (no indicator snapshot)
    """
    _cleanup()
    _seed()

    candidates = pass2_score(list(PASS1_EXPECTED))
    by_sym = {c["symbol"]: c for c in candidates}

    # SCR_I has no indicator snapshot → must be absent
    assert "SCR_I" not in by_sym, "SCR_I should be excluded (no snapshot)"

    assert by_sym["SCR_A"]["signal_score"] == 4, f"SCR_A score: {by_sym['SCR_A']['signal_score']}"
    assert by_sym["SCR_J"]["signal_score"] == 3, f"SCR_J score: {by_sym['SCR_J']['signal_score']}"
    assert by_sym["SCR_B"]["signal_score"] == 2, f"SCR_B score: {by_sym['SCR_B']['signal_score']}"
    assert by_sym["SCR_H"]["signal_score"] == 1, f"SCR_H score: {by_sym['SCR_H']['signal_score']}"
    assert by_sym["SCR_C"]["signal_score"] == 0, f"SCR_C score: {by_sym['SCR_C']['signal_score']}"

    # Verify ranking is descending by score
    scores = [c["signal_score"] for c in candidates]
    assert scores == sorted(scores, reverse=True), "Candidates not sorted by score descending"

    # Rank 1 must be SCR_A
    assert candidates[0]["rank"] == 1
    assert candidates[0]["symbol"] == "SCR_A"

    _cleanup()


# -------------------------------------------------------------------------
# Criterion 3: Results persist and are retrievable
# -------------------------------------------------------------------------

def test_results_persist_and_are_retrievable():
    """
    save_results then get_latest_results should return the same rows.
    """
    _cleanup()
    _seed()

    run_at = datetime.now(timezone.utc)
    candidates = pass2_score(list(PASS1_EXPECTED))
    saved_count = save_results(candidates, run_at)
    assert saved_count == len(candidates), f"Expected {len(candidates)} rows saved"

    rows = get_latest_results(limit=50)
    retrieved_symbols = {r["symbol"] for r in rows}
    expected_symbols  = {c["symbol"] for c in candidates}
    assert expected_symbols == retrieved_symbols, (
        f"Mismatch: saved {expected_symbols}, got {retrieved_symbols}"
    )

    # Verify rank ordering in retrieved results
    ranks = [r["rank"] for r in rows]
    assert ranks == sorted(ranks), "Retrieved results not ordered by rank"

    _cleanup()


# -------------------------------------------------------------------------
# Criterion 4: Run completes in under 2 minutes (warm cache)
# -------------------------------------------------------------------------

def test_screener_run_completes_quickly():
    """
    Full run_screener() with seeded data should complete well under 2 minutes.
    With a warm cache and 10 test tickers this should be < 5 seconds.
    """
    _cleanup()
    _seed()

    start = time.time()
    run_at, candidates = run_screener()
    elapsed = time.time() - start

    assert elapsed < 120, f"Screener took {elapsed:.1f}s (limit 120s)"
    assert isinstance(candidates, list)

    _cleanup()
