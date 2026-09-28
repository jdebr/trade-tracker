"""
Tests for the ticker details panel endpoint (GET /tickers/{symbol}/details) and
on-demand candlestick history (candlesticks.recent_patterns).

DB reads are mocked; TA-Lib runs for real on synthetic bars.
"""

from datetime import date, timedelta
from unittest.mock import patch

import pandas as pd
from fastapi.testclient import TestClient

from app.services import ticker_details as td
from app.services.candlesticks import recent_patterns


def _bars(rows, start=date(2026, 8, 3)):
    """[[o, h, l, c], ...] -> cached-bar dicts, oldest first, one per weekday."""
    out, d = [], start
    for o, h, l, c in rows:
        while d.weekday() >= 5:
            d += timedelta(days=1)
        out.append({"symbol": "AAPL", "date": d.isoformat(), "open": o, "high": h, "low": l,
                    "close": c, "volume": 1_000_000})
        d += timedelta(days=1)
    return out


def _down(n=20, start=120.0):
    rows, p = [], start
    for _ in range(n):
        rows.append([p, p + 0.3, p - 1.3, p - 1.0])
        p -= 1.0
    return rows


def _with_hammer_then(n_after):
    rows = _down()
    last = rows[-1][3]
    rows.append([last - 0.2, last + 0.05, last - 3.5, last + 0.1])      # hammer
    p = rows[-1][3]
    rows += [[q, q + 0.3, q - 1.3, q - 1.0] for q in (p - i for i in range(n_after))]
    return rows


def _frame(bars):
    from app.services.indicators import bars_to_dataframe
    return bars_to_dataframe(bars)


# ---------------------------------------------------------------------------
# recent_patterns
# ---------------------------------------------------------------------------

def test_recent_patterns_dates_each_pattern():
    bars = _bars(_with_hammer_then(3))
    out = recent_patterns(_frame(bars), bars=10)
    hammer = [p for p in out if p["name"] == "cdl_hammer"]
    assert len(hammer) == 1
    assert hammer[0]["date"] == bars[-4]["date"]          # 3 bars before the latest
    assert hammer[0]["direction"] == "bullish" and hammer[0]["meaning"]


def test_recent_patterns_window_and_order():
    bars = _bars(_with_hammer_then(3))
    assert not [p for p in recent_patterns(_frame(bars), bars=3) if p["name"] == "cdl_hammer"]
    out = recent_patterns(_frame(bars), bars=10)
    assert [p["date"] for p in out] == sorted((p["date"] for p in out), reverse=True)


def test_recent_patterns_short_history():
    assert recent_patterns(_frame(_bars(_down(10))), bars=10) == []


# ---------------------------------------------------------------------------
# get_ticker_details
# ---------------------------------------------------------------------------

SNAP = {"symbol": "AAPL", "date": "2026-09-25", "rsi_14": 30.0, "bb_squeeze": True, "ema_50": 100.0,
        "extra": {"cdl_hammer": True}}
RULES = [
    {"slug": "oversold", "name": "Oversold", "weight": 2, "expression": {"<": [{"var": "rsi_14"}, 35]}},
    {"slug": "squeeze", "name": "Squeeze", "weight": 1, "expression": {"!": [{"var": "bb_squeeze"}]}},
]


def _details(ticker=None, bars=None, snaps=None, position=None, in_watchlist=True, days=10):
    ticker = {"symbol": "AAPL", "name": "Apple Inc.", "sector": "Tech", "industry": "Hardware"} if ticker is None else ticker
    rows = {"tickers": ticker or None, "positions": position,
            "watchlist": {"symbol": "AAPL"} if in_watchlist else None}
    with patch.object(td, "_one", side_effect=lambda table, *a, **k: rows[table]), \
         patch.object(td, "get_cached_bars", return_value=_bars(_with_hammer_then(2)) if bars is None else bars), \
         patch.object(td, "get_latest_snapshots", return_value=[SNAP] if snaps is None else snaps), \
         patch.object(td.sr, "get_enabled_rules", return_value=RULES):
        return td.get_ticker_details("aapl", days)


def test_details_assembles_every_section():
    d = _details()
    assert d["symbol"] == "AAPL" and d["name"] == "Apple Inc." and d["in_watchlist"] is True
    assert len(d["bars"]) == 23 and set(d["bars"][0]) == {"date", "open", "high", "low", "close", "volume"}
    assert d["last"]["close"] == d["bars"][-1]["close"]
    assert d["last"]["change"] == -1.0
    assert any(p["name"] == "cdl_hammer" for p in d["patterns"])
    assert d["snapshot"]["date"] == "2026-09-25"
    assert d["signals"]["score"] == 2 and d["signals"]["max"] == 3
    assert [r["fired"] for r in d["signals"]["rules"]] == [True, False]
    assert d["signals"]["rules"][0]["formatted"] == "RSI(14) < 35"
    assert d["position"] is None


def test_details_without_snapshot_has_no_signals():
    d = _details(snaps=[])
    assert d["snapshot"] is None and d["signals"] is None
    assert d["patterns"]                                   # computed from bars regardless


def test_details_open_position_current_r():
    pos = {"id": "p1", "direction": "long", "entry_price": "100", "risk_per_share": "5",
           "stop_price": "95", "shares": "10"}
    bars = _bars([[100, 111, 99, 110]] * 20)
    d = _details(bars=bars, position=pos)
    assert d["position"]["r_now"] == 2.0                   # (110 - 100) / 5


def test_details_unknown_symbol_is_none():
    assert _details(ticker={}, bars=[]) is None


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

def test_route_404_and_validation():
    from app.main import app
    client = TestClient(app)
    with patch("app.routers.tickers.get_ticker_details", return_value=None):
        assert client.get("/tickers/ZZZZ/details").status_code == 404
    assert client.get("/tickers/AAPL/details?days=0").status_code == 422
    assert client.get("/tickers/AAPL/details?days=41").status_code == 422
    assert client.get("/tickers/bad$sym/details").status_code == 422


def test_route_passes_days():
    from app.main import app
    with patch("app.routers.tickers.get_ticker_details", return_value={"symbol": "AAPL"}) as g:
        r = TestClient(app).get("/tickers/aapl/details?days=5")
    assert r.status_code == 200
    g.assert_called_once_with("aapl", 5)
