"""
Screener min_score filter, live watchlist scoring, and restart-proof "last update".

- GET /screener/results?min_score=1 hides zero-score rows (all rows still stored)
- score_symbols / GET /screener/scores score symbols live against current rules
- upsert_bars stamps fetched_at on every write (it only defaults on INSERT)
- latest_fetch_at reads the newest pull from the cache; scheduler status exposes it
"""

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.services import ohlcv_cache, screener
from app.services import scheduler as sched

client = TestClient(app)


class Chain:
    """Records a PostgREST-style call chain and returns canned data."""

    def __init__(self, data):
        self.data_out = data
        self.calls = []

    def __getattr__(self, name):
        def method(*args, **kwargs):
            self.calls.append((name, args, kwargs))
            return self
        return method

    def execute(self):
        return type("R", (), {"data": self.data_out})()


def _client_with(chain):
    c = MagicMock()
    c.table.return_value = chain
    return c


# ---------------------------------------------------------------------------
# min_score
# ---------------------------------------------------------------------------

def test_results_for_run_applies_min_score():
    chain = Chain([{"symbol": "A", "signal_score": 2}])
    with patch("app.services.screener.get_client", return_value=_client_with(chain)):
        screener.get_results_by_run("2026-09-01T00:00:00+00:00", limit=1000, min_score=1)
    assert ("gte", ("signal_score", 1), {}) in chain.calls
    assert ("limit", (1000,), {}) in chain.calls


def test_results_for_run_without_min_score_returns_everything():
    chain = Chain([])
    with patch("app.services.screener.get_client", return_value=_client_with(chain)):
        screener.get_results_by_run("2026-09-01T00:00:00+00:00", limit=50)
    assert not any(name == "gte" for name, *_ in chain.calls)


def test_results_endpoint_accepts_min_score_and_large_limit():
    with patch("app.routers.screener.get_latest_results", return_value=[]) as m:
        resp = client.get("/screener/results?min_score=1&limit=1000")
    assert resp.status_code == 200
    m.assert_called_once_with(1000, 1)


# ---------------------------------------------------------------------------
# Live scores
# ---------------------------------------------------------------------------

RULES = [
    {"slug": "bb_squeeze", "weight": 1, "expression": {"var": "bb_squeeze"}},
    {"slug": "oversold", "weight": 2, "expression": {"<": [{"var": "rsi_14"}, 30]}},
]


def test_score_symbols_scores_live_and_nulls_missing_snapshots():
    contexts = {
        "AAPL": {"bb_squeeze": True, "rsi_14": 25.0, "close": 100.0},
        "MSFT": {"bb_squeeze": False, "rsi_14": 50.0, "close": 300.0},
        # NVDA: no snapshot at all
    }
    with patch("app.services.screener.sr.get_enabled_rules", return_value=RULES), \
         patch("app.services.screener.build_feature_contexts", return_value=contexts), \
         patch("app.services.screener.snapshot_present", side_effect=lambda f: bool(f)):
        out = screener.score_symbols(["aapl", "MSFT", "NVDA"])
    assert out["AAPL"]["signal_score"] == 3
    assert out["AAPL"]["max_signal_score"] == 3
    assert out["MSFT"]["signal_score"] == 0
    assert out["NVDA"] is None


def test_scores_endpoint():
    with patch("app.routers.screener.score_symbols", return_value={"AAPL": None}) as m:
        resp = client.get("/screener/scores?symbols=AAPL, MSFT")
    assert resp.status_code == 200
    m.assert_called_once_with(["AAPL", "MSFT"])


def test_scores_endpoint_caps_symbol_count():
    resp = client.get("/screener/scores?symbols=" + ",".join(f"S{i}" for i in range(201)))
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# fetched_at + last update
# ---------------------------------------------------------------------------

def test_upsert_bars_stamps_fetched_at_on_every_write():
    chain = Chain([{"id": 1}])
    bars = [{"symbol": "AAPL", "date": "2026-09-25", "close": 1.0}]
    with patch("app.services.ohlcv_cache.get_client", return_value=_client_with(chain)):
        ohlcv_cache.upsert_bars(bars)
    (name, args, _), = [c for c in chain.calls if c[0] == "upsert"]
    assert "fetched_at" in args[0][0]
    assert "fetched_at" not in bars[0]  # caller's dicts untouched


def test_latest_fetch_at_returns_newest_or_none():
    chain = Chain([{"fetched_at": "2026-09-25T20:15:00+00:00"}])
    with patch("app.services.ohlcv_cache.get_client", return_value=_client_with(chain)):
        assert ohlcv_cache.latest_fetch_at(["aapl"]) == "2026-09-25T20:15:00+00:00"
    assert ("in_", ("symbol", ["AAPL"]), {}) in chain.calls
    assert ("order", ("fetched_at",), {"desc": True}) in chain.calls
    assert ohlcv_cache.latest_fetch_at([]) is None


def test_status_reports_last_data_at_even_after_restart():
    # In-memory last run is gone (fresh process), but the cache still knows.
    with patch.object(sched, "_last_run_at", None), \
         patch("app.services.ohlcv_cache.latest_fetch_at", return_value="2026-09-25T20:15:00+00:00"), \
         patch("app.database.get_client", return_value=_client_with(Chain([{"symbol": "AAPL"}]))), \
         patch.object(sched, "fetch_td_api_usage", return_value=None):
        status = sched.get_status()
    assert status["last_run_at"] is None
    assert status["last_data_at"] == "2026-09-25T20:15:00+00:00"


def test_status_survives_last_data_lookup_failure():
    with patch("app.database.get_client", side_effect=RuntimeError("db down")), \
         patch.object(sched, "fetch_td_api_usage", return_value=None):
        status = sched.get_status()
    assert status["last_data_at"] is None
