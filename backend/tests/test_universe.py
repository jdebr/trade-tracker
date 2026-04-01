"""
Tests for universe.py — datahub.io fetch and static CSV fallback behaviour.
"""

import csv
import json
from pathlib import Path
from unittest.mock import patch, MagicMock

import pandas as pd
import pytest

from app.services.universe import load_sp500_symbols, _STATIC_CSV


def _fake_datahub_response(symbols: list[dict]):
    """Build a mock requests.Response returning the given symbol list as JSON."""
    mock_resp = MagicMock()
    mock_resp.raise_for_status.return_value = None
    mock_resp.json.return_value = symbols
    return mock_resp


def test_datahub_success_returns_symbols_and_refreshes_csv(tmp_path):
    """
    When datahub.io fetch succeeds, the returned symbols are normalised
    (dot→dash) and the static CSV is refreshed with the new data.
    """
    fake_data = [
        {"Symbol": "FAKE1", "Name": "Fake Co 1", "Sector": "Technology"},
        {"Symbol": "FAKE2", "Name": "Fake Co 2", "Sector": "Financials"},
        {"Symbol": "BRK.B", "Name": "Berkshire Hathaway", "Sector": "Financials"},
    ]
    tmp_csv = tmp_path / "sp500.csv"

    with patch("app.services.universe.requests.get", return_value=_fake_datahub_response(fake_data)), \
         patch("app.services.universe._STATIC_CSV", tmp_csv):
        result = load_sp500_symbols()

    assert {r["symbol"] for r in result} == {"FAKE1", "FAKE2", "BRK-B"}

    with open(tmp_csv, newline="") as f:
        saved = {row["symbol"] for row in csv.DictReader(f)}
    assert saved == {"FAKE1", "FAKE2", "BRK-B"}


def test_datahub_failure_falls_back_to_csv(tmp_path):
    """
    When datahub.io fetch fails, the static CSV is returned untouched.
    """
    tmp_csv = tmp_path / "sp500.csv"
    tmp_csv.write_text("symbol,name,sector,is_etf\nAAPL,Apple,Technology,false\n")

    with patch("app.services.universe.requests.get", side_effect=Exception("network error")), \
         patch("app.services.universe._STATIC_CSV", tmp_csv):
        result = load_sp500_symbols()

    assert [r["symbol"] for r in result] == ["AAPL"]

    # CSV must be untouched
    with open(tmp_csv, newline="") as f:
        symbols = [row["symbol"] for row in csv.DictReader(f)]
    assert symbols == ["AAPL"]


def test_csv_write_failure_does_not_raise():
    """
    If writing the refreshed CSV fails (e.g. read-only filesystem),
    load_sp500_symbols must still return the fetched data without raising.
    """
    fake_data = [{"Symbol": "AAPL", "Name": "Apple", "Sector": "Technology"}]

    with patch("app.services.universe.requests.get", return_value=_fake_datahub_response(fake_data)), \
         patch("app.services.universe._STATIC_CSV", Path("/nonexistent/path/sp500.csv")):
        result = load_sp500_symbols()  # must not raise

    assert result[0]["symbol"] == "AAPL"


def test_dot_to_dash_normalisation():
    """Symbols with dots (BRK.B) are normalised to dashes (BRK-B)."""
    fake_data = [{"Symbol": "BRK.B", "Name": "Berkshire", "Sector": "Financials"}]

    with patch("app.services.universe.requests.get", return_value=_fake_datahub_response(fake_data)), \
         patch("app.services.universe._STATIC_CSV", Path("/nonexistent/path/sp500.csv")):
        result = load_sp500_symbols()

    assert result[0]["symbol"] == "BRK-B"


def test_is_etf_always_false():
    """All symbols loaded from datahub.io have is_etf=False."""
    fake_data = [{"Symbol": "AAPL", "Name": "Apple", "Sector": "Technology"}]

    with patch("app.services.universe.requests.get", return_value=_fake_datahub_response(fake_data)), \
         patch("app.services.universe._STATIC_CSV", Path("/nonexistent/path/sp500.csv")):
        result = load_sp500_symbols()

    assert result[0]["is_etf"] is False
