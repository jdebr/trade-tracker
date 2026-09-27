"""
Slice 0 of M20: bulk reads return one row per symbol (reduced in Postgres by the
migration-004 functions), so PostgREST's 1000-row response cap can't truncate
them, and per-symbol query loops are gone.

All DB calls are mocked — no real Supabase connection required.
"""

from datetime import date, timedelta
from unittest.mock import MagicMock, patch

from app import database
from app.database import rpc_per_symbol
from app.services import ohlcv_cache, scanner, universe
from app.services.indicator_cache import get_latest_snapshots, get_prior_snapshots


def _rpc_client(fn_rows):
    """Client whose .rpc(fn, params) returns fn_rows(fn, params)."""
    client = MagicMock()

    def rpc(fn, params):
        call = MagicMock()
        call.execute.return_value.data = fn_rows(fn, params)
        return call

    client.rpc.side_effect = rpc
    return client


def _summary_row(sym, last_date, close=10.0):
    return {"symbol": sym, "last_date": last_date, "last_close": close, "bar_count": 1,
            "vol_3d": 1.0, "vol_avg": 1.0, "last_fetched_at": None}


# ---------------------------------------------------------------------------
# rpc_per_symbol
# ---------------------------------------------------------------------------

def test_rpc_per_symbol_chunks_dedupes_and_uppercases():
    seen = []
    client = _rpc_client(lambda fn, p: seen.append(p) or [{"symbol": s} for s in p["p_symbols"]])
    syms = [f"s{i}" for i in range(database.RPC_SYMBOL_CHUNK + 20)] + ["S0", "", None]
    with patch.object(database, "get_client", return_value=client):
        rows = rpc_per_symbol("fn", syms, p_window=5)
    assert len(seen) == 2                                   # one call per 500 symbols
    assert all(len(p["p_symbols"]) <= database.RPC_SYMBOL_CHUNK for p in seen)
    assert all(p["p_window"] == 5 for p in seen)
    assert len(rows) == database.RPC_SYMBOL_CHUNK + 20      # "s0"/"S0" deduped, blanks dropped
    assert all(r["symbol"].isupper() for r in rows)


def test_rpc_per_symbol_empty_makes_no_call():
    client = MagicMock()
    with patch.object(database, "get_client", return_value=client):
        assert rpc_per_symbol("fn", []) == []
    client.rpc.assert_not_called()


# ---------------------------------------------------------------------------
# Snapshots
# ---------------------------------------------------------------------------

def test_latest_and_prior_snapshots_use_one_row_per_symbol_functions():
    calls = []
    client = _rpc_client(lambda fn, p: calls.append(fn) or [{"symbol": "AAPL", "date": "2026-09-25"}])
    with patch.object(database, "get_client", return_value=client):
        assert get_latest_snapshots(["aapl"]) == [{"symbol": "AAPL", "date": "2026-09-25"}]
        assert get_prior_snapshots(["aapl"]) == {"AAPL": {"symbol": "AAPL", "date": "2026-09-25"}}
    assert calls == ["latest_indicator_snapshots", "prior_indicator_snapshots"]


def test_scanner_prior_snapshots_maps_missing_to_none():
    with patch.object(scanner, "get_prior_snapshots", return_value={"AAPL": {"macd_hist": 1}}):
        assert scanner._get_prior_snapshots(["AAPL", "NEW"]) == {"AAPL": {"macd_hist": 1}, "NEW": None}


# ---------------------------------------------------------------------------
# OHLCV summary, freshness, market data
# ---------------------------------------------------------------------------

def test_ohlcv_summary_converts_numeric_strings():
    row = {"symbol": "AAPL", "last_date": "2026-09-25", "last_close": "213.4900", "bar_count": 20,
           "vol_3d": "3000000.0", "vol_avg": "2000000.5", "last_fetched_at": "2026-09-25T20:15:00+00:00"}
    client = _rpc_client(lambda fn, p: [row])
    with patch.object(database, "get_client", return_value=client):
        out = ohlcv_cache.get_ohlcv_summary(["AAPL"])
    assert out["AAPL"]["last_close"] == 213.49
    assert out["AAPL"]["vol_avg"] == 2000000.5
    assert out["AAPL"]["bar_count"] == 20
    client.rpc.assert_called_once_with("ohlcv_summary", {"p_symbols": ["AAPL"], "p_window": 20})


def test_bulk_check_freshness_single_call_keeps_caller_keys():
    today = date.today()
    fresh = today.isoformat()
    stale = (today - timedelta(days=30)).isoformat()
    client = _rpc_client(lambda fn, p: [_summary_row("AAPL", fresh), _summary_row("OLD", stale)])
    with patch.object(database, "get_client", return_value=client):
        out = ohlcv_cache.bulk_check_freshness(["aapl", "OLD", "NONE"])
    assert out == {"aapl": True, "OLD": False, "NONE": False}
    assert client.rpc.call_count == 1


def test_scanner_market_data_from_summary():
    summary = {"AAPL": {"last_close": 10.0, "vol_3d": 3.0, "vol_avg": 2.0}}
    with patch.object(scanner, "get_ohlcv_summary", return_value=summary) as s:
        out = scanner._get_market_data(["AAPL", "NONE"])
    s.assert_called_once_with(["AAPL", "NONE"], window=20)
    assert out == {"AAPL": {"vol_3d": 3.0, "vol_20d": 2.0, "last_close": 10.0}}


def test_scanner_fetch_checks_freshness_in_bulk():
    result = scanner.ScanResult()
    with patch.object(scanner, "bulk_check_freshness", return_value={"AAPL": True, "MSFT": False}) as fr, \
         patch.object(scanner, "fetch_ohlcv", return_value=[{"symbol": "MSFT"}]) as fetch, \
         patch.object(scanner, "upsert_bars") as up:
        scanner._fetch_ohlcv_for_symbols(["AAPL", "MSFT"], result)
    fr.assert_called_once_with(["AAPL", "MSFT"])
    fetch.assert_called_once_with("MSFT")
    up.assert_called_once_with([{"symbol": "MSFT"}])
    assert result.ohlcv_cached == 1 and result.ohlcv_fetched == 1


# ---------------------------------------------------------------------------
# Ticker metadata
# ---------------------------------------------------------------------------

def test_update_ticker_metadata_is_one_statement_per_chunk():
    client = MagicMock()
    client.rpc.return_value.execute.return_value.data = 7
    syms = [f"S{i}" for i in range(database.RPC_SYMBOL_CHUNK + 1)]
    with patch.object(universe, "get_client", return_value=client):
        universe.update_ticker_metadata(syms)
    assert client.rpc.call_count == 2
    assert client.rpc.call_args_list[0].args[0] == "refresh_ticker_metadata"
    client.table.assert_not_called()                        # no per-ticker reads/updates
