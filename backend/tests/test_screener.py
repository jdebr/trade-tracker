"""
Tests for the two-pass screener (app/services/screener.py).

All DB calls are mocked — no real Supabase connection required.

Criteria:
1. Pass 1 returns symbols from the DB result (filtering is DB-side)
2. Pass 2 scores and ranks symbols correctly given injected indicator/volume data
3. save_results inserts the right rows; get_latest_results retrieves them
4. run_screener orchestrates pass1 → pass2 → save in order (no data fetching)
5. run_screener returns (datetime, []) immediately when pass1 has no survivors
6. _get_recent_volumes issues a single bulk query (not one per symbol)
7. GET /screener/results returns 200 [] (not 404) when no runs exist yet
"""

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch, call
import pytest
from fastapi.testclient import TestClient

from app.services.screener import (
    pass1_filter,
    pass2_score,
    save_results,
    get_latest_results,
    run_screener,
    _get_recent_volumes,
)


# ---------------------------------------------------------------------------
# Criterion 1: pass1_filter extracts symbols from DB result
# ---------------------------------------------------------------------------

def test_pass1_filter_returns_symbols_from_db():
    """
    pass1_filter should return whatever symbols the DB query gives back.
    The actual filtering (volume/price/etf thresholds) is enforced by the
    chained .eq/.gt/.gte/.lte calls on the query — we verify the right symbols
    are extracted from the response.
    """
    db_rows = [{"symbol": "AAPL"}, {"symbol": "MSFT"}, {"symbol": "NVDA"}]

    mock_client = MagicMock()
    (mock_client.table.return_value
                .select.return_value
                .eq.return_value
                .gt.return_value
                .gte.return_value
                .lte.return_value
                .execute.return_value.data) = db_rows

    with patch("app.services.screener.get_client", return_value=mock_client):
        result = pass1_filter()

    assert result == ["AAPL", "MSFT", "NVDA"]


def test_pass1_filter_returns_empty_when_no_survivors():
    mock_client = MagicMock()
    (mock_client.table.return_value
                .select.return_value
                .eq.return_value
                .gt.return_value
                .gte.return_value
                .lte.return_value
                .execute.return_value.data) = []

    with patch("app.services.screener.get_client", return_value=mock_client):
        result = pass1_filter()

    assert result == []


# ---------------------------------------------------------------------------
# Criterion 2: pass2_score scores and ranks correctly
# ---------------------------------------------------------------------------

# Fixture: injected indicator snapshots
_INDICATORS = {
    # rsi in range, bb_squeeze, close > ema_50, vol expanding → 4
    "SCR_A": {"symbol": "SCR_A", "date": "2026-04-01", "rsi_14": 50.0, "bb_squeeze": True,  "ema_50": 140.0},
    # rsi in range, bb_squeeze, close < ema_50, no vol expansion → 2
    "SCR_B": {"symbol": "SCR_B", "date": "2026-04-01", "rsi_14": 45.0, "bb_squeeze": True,  "ema_50": 90.0},
    # rsi out of range, no bb_squeeze, close < ema_50, no vol expansion → 0
    "SCR_C": {"symbol": "SCR_C", "date": "2026-04-01", "rsi_14": 75.0, "bb_squeeze": False, "ema_50": 210.0},
    # rsi out of range, no bb_squeeze, close > ema_50, no vol expansion → 1
    "SCR_H": {"symbol": "SCR_H", "date": "2026-04-01", "rsi_14": 25.0, "bb_squeeze": False, "ema_50": 70.0},
    # no snapshot entry → excluded from pass 2
    # "SCR_I": omitted intentionally
    # rsi in range, bb_squeeze, close > ema_50, no vol expansion → 3
    "SCR_J": {"symbol": "SCR_J", "date": "2026-04-01", "rsi_14": 60.0, "bb_squeeze": True,  "ema_50": 80.0},
}

# Fixture: injected volume/close data
_VOL_DATA = {
    "SCR_A": {"vol_3d": 3_000_000, "vol_20d": 1_000_000, "last_close": 150.0},  # expanding
    "SCR_B": {"vol_3d": 1_000_000, "vol_20d": 1_000_000, "last_close": 80.0},   # flat
    "SCR_C": {"vol_3d": 1_000_000, "vol_20d": 1_000_000, "last_close": 200.0},  # flat
    "SCR_H": {"vol_3d": 1_000_000, "vol_20d": 1_000_000, "last_close": 75.0},   # flat
    "SCR_I": {"vol_3d": 1_000_000, "vol_20d": 1_000_000, "last_close": 120.0},  # no snap → excluded
    "SCR_J": {"vol_3d": 1_000_000, "vol_20d": 1_000_000, "last_close": 90.0},   # flat
}

_ALL_SYMBOLS = ["SCR_A", "SCR_B", "SCR_C", "SCR_H", "SCR_I", "SCR_J"]


def test_pass2_score_scores_and_ranks_correctly():
    """
    Verify expected signal_score for each symbol and descending rank order.
    SCR_I has no indicator snapshot and must be absent from the results.
    """
    with patch("app.services.screener._get_indicators", return_value=_INDICATORS), \
         patch("app.services.screener._get_recent_volumes", return_value=_VOL_DATA):
        candidates = pass2_score(_ALL_SYMBOLS)

    by_sym = {c["symbol"]: c for c in candidates}

    assert "SCR_I" not in by_sym, "SCR_I has no snapshot — must be excluded"

    assert by_sym["SCR_A"]["signal_score"] == 4
    assert by_sym["SCR_J"]["signal_score"] == 3
    assert by_sym["SCR_B"]["signal_score"] == 2
    assert by_sym["SCR_H"]["signal_score"] == 1
    assert by_sym["SCR_C"]["signal_score"] == 0

    scores = [c["signal_score"] for c in candidates]
    assert scores == sorted(scores, reverse=True), "Candidates must be ranked descending"

    assert candidates[0]["rank"] == 1
    assert candidates[0]["symbol"] == "SCR_A"


# ---------------------------------------------------------------------------
# Criterion 3: save_results / get_latest_results round-trip
# ---------------------------------------------------------------------------

def test_save_results_inserts_correct_number_of_rows():
    """save_results should insert one row per candidate and return the count."""
    run_at = datetime(2026, 4, 1, 20, 0, 0, tzinfo=timezone.utc)

    with patch("app.services.screener._get_indicators", return_value=_INDICATORS), \
         patch("app.services.screener._get_recent_volumes", return_value=_VOL_DATA):
        candidates = pass2_score(_ALL_SYMBOLS)

    mock_client = MagicMock()
    mock_client.table.return_value.insert.return_value.execute.return_value.data = candidates

    with patch("app.services.screener.get_client", return_value=mock_client):
        count = save_results(candidates, run_at)

    assert count == len(candidates)
    # Verify the rows passed to insert contain all candidate symbols
    call_args = mock_client.table.return_value.insert.call_args[0][0]
    symbols_inserted = {r["symbol"] for r in call_args}
    assert symbols_inserted == {c["symbol"] for c in candidates}


def test_get_latest_results_returns_most_recent_run():
    """get_latest_results should query the most-recent run_at then fetch its rows."""
    run_at_str = "2026-04-01T20:00:00+00:00"
    rows = [
        {"symbol": "SCR_A", "rank": 1, "signal_score": 4, "run_at": run_at_str},
        {"symbol": "SCR_J", "rank": 2, "signal_score": 3, "run_at": run_at_str},
    ]

    mock_client = MagicMock()
    # First call: find latest run_at
    mock_client.table.return_value.select.return_value.order.return_value.limit.return_value.execute.return_value.data = [{"run_at": run_at_str}]
    # Second call: fetch rows for that run_at
    mock_client.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = rows

    with patch("app.services.screener.get_client", return_value=mock_client):
        result = get_latest_results(limit=50)

    assert result == rows


# ---------------------------------------------------------------------------
# Criterion 4: run_screener orchestrates without data fetching
# ---------------------------------------------------------------------------

def test_run_screener_orchestrates_correctly():
    """
    run_screener should: pass1 → pass2 → save, with no _fetch_and_compute step.
    Verify each DB-only step is called and (datetime, list) is returned.
    """
    call_order = []

    with patch("app.services.screener.pass1_filter", return_value=["AAPL", "MSFT"]), \
         patch("app.services.screener.pass2_score", side_effect=lambda s: call_order.append("pass2") or []) as p2, \
         patch("app.services.screener.save_results", side_effect=lambda c, r: call_order.append("save")) as sr:
        run_at, candidates = run_screener()

    assert isinstance(run_at, datetime)
    assert isinstance(candidates, list)
    assert "pass2" in call_order
    assert "save"  in call_order
    assert call_order.index("pass2") < call_order.index("save")


# ---------------------------------------------------------------------------
# Criterion 5: run_screener returns empty immediately when pass1 has no survivors
# ---------------------------------------------------------------------------

def test_run_screener_returns_empty_when_no_pass1_survivors():
    """
    run_screener should return (datetime, []) immediately if pass1 returns no
    symbols — it must NOT attempt any data fetching or call pass2/save.
    """
    save_mock = MagicMock()
    pass2_mock = MagicMock()

    with patch("app.services.screener.pass1_filter", return_value=[]), \
         patch("app.services.screener.pass2_score", pass2_mock), \
         patch("app.services.screener.save_results", save_mock):
        run_at, candidates = run_screener()

    assert isinstance(run_at, datetime)
    assert candidates == []
    pass2_mock.assert_not_called()
    save_mock.assert_not_called()


# ---------------------------------------------------------------------------
# Criterion 6: _get_recent_volumes issues a single bulk query
# ---------------------------------------------------------------------------

def test_get_recent_volumes_uses_single_bulk_query():
    """
    _get_recent_volumes must issue ONE .in_() query for all symbols rather than
    one round-trip per symbol. Results are grouped by symbol in Python.
    """
    mock_client = MagicMock()
    (mock_client.table.return_value
                .select.return_value
                .in_.return_value
                .order.return_value
                .limit.return_value
                .execute.return_value.data) = [
        {"symbol": "AAPL", "date": "2026-04-01", "close": 150.0, "volume": 2_000_000},
        {"symbol": "AAPL", "date": "2026-03-31", "close": 148.0, "volume": 1_800_000},
        {"symbol": "AAPL", "date": "2026-03-28", "close": 147.0, "volume": 1_500_000},
        {"symbol": "MSFT", "date": "2026-04-01", "close": 420.0, "volume": 3_000_000},
        {"symbol": "MSFT", "date": "2026-03-31", "close": 418.0, "volume": 2_800_000},
    ]

    with patch("app.services.screener.get_client", return_value=mock_client):
        result = _get_recent_volumes(["AAPL", "MSFT"])

    # Single .in_() call — not one per symbol
    assert mock_client.table.return_value.select.return_value.in_.call_count == 1

    assert "AAPL" in result
    assert "MSFT" in result
    # vol_3d for AAPL: avg of first 3 bars = (2M + 1.8M + 1.5M) / 3
    assert result["AAPL"]["vol_3d"] == pytest.approx((2_000_000 + 1_800_000 + 1_500_000) / 3)
    assert result["AAPL"]["last_close"] == pytest.approx(150.0)


# ---------------------------------------------------------------------------
# Criterion 7: GET /screener/results returns 200 [] when no runs exist yet
# ---------------------------------------------------------------------------

def test_get_latest_results_returns_empty_list_when_no_runs():
    """get_latest_results should return [] (not raise) when the table has no rows."""
    mock_client = MagicMock()
    mock_client.table.return_value.select.return_value.order.return_value.limit.return_value.execute.return_value.data = []

    with patch("app.services.screener.get_client", return_value=mock_client):
        result = get_latest_results()

    assert result == []


def test_screener_results_endpoint_returns_200_empty_list_when_no_runs():
    """
    GET /screener/results should return HTTP 200 with an empty list when no
    screener runs have been saved — not 404.
    """
    from app.main import app

    mock_client = MagicMock()
    mock_client.table.return_value.select.return_value.order.return_value.limit.return_value.execute.return_value.data = []

    with patch("app.services.screener.get_client", return_value=mock_client):
        response = TestClient(app).get("/screener/results")

    assert response.status_code == 200
    assert response.json() == []
