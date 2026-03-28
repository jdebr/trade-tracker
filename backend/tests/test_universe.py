"""
Tests for universe.py — specifically the static CSV refresh behaviour.
"""

import csv
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock
import pandas as pd

from app.services.universe import load_sp500_symbols, _STATIC_CSV


def _read_csv_symbols() -> set[str]:
    with open(_STATIC_CSV, newline="") as f:
        return {row["symbol"] for row in csv.DictReader(f)}


def test_wikipedia_success_refreshes_csv(tmp_path):
    """
    When Wikipedia fetch succeeds, the static CSV must be overwritten with
    the returned symbols.
    """
    # Fake Wikipedia response — 3 symbols not currently in the real CSV
    fake_df = pd.DataFrame([
        {"Symbol": "FAKE1", "Security": "Fake Co 1", "GICS Sector": "Technology"},
        {"Symbol": "FAKE2", "Security": "Fake Co 2", "GICS Sector": "Financials"},
        {"Symbol": "BRK.B", "Security": "Berkshire Hathaway", "GICS Sector": "Financials"},
    ])

    tmp_csv = tmp_path / "sp500.csv"

    with (
        patch("app.services.universe.pd.read_html", return_value=[fake_df]),
        patch("app.services.universe._STATIC_CSV", tmp_csv),
    ):
        result = load_sp500_symbols()

    assert {r["symbol"] for r in result} == {"FAKE1", "FAKE2", "BRK-B"}  # dot→dash normalised

    saved = set()
    with open(tmp_csv, newline="") as f:
        saved = {row["symbol"] for row in csv.DictReader(f)}

    assert saved == {"FAKE1", "FAKE2", "BRK-B"}, (
        f"CSV not refreshed correctly: {saved}"
    )


def test_wikipedia_failure_does_not_overwrite_csv(tmp_path):
    """
    When Wikipedia fetch fails, the static CSV must be left untouched and
    its contents returned instead.
    """
    # Seed a minimal CSV in tmp_path
    tmp_csv = tmp_path / "sp500.csv"
    tmp_csv.write_text("symbol,name,sector,is_etf\nAAPL,Apple,Technology,false\n")

    with (
        patch("app.services.universe.pd.read_html", side_effect=Exception("network error")),
        patch("app.services.universe._STATIC_CSV", tmp_csv),
    ):
        result = load_sp500_symbols()

    assert [r["symbol"] for r in result] == ["AAPL"]

    # CSV must still contain only AAPL
    with open(tmp_csv, newline="") as f:
        symbols = [row["symbol"] for row in csv.DictReader(f)]
    assert symbols == ["AAPL"], "CSV was modified despite Wikipedia failure"


def test_csv_write_failure_does_not_raise():
    """
    If writing the CSV fails (e.g. read-only filesystem), load_sp500_symbols
    must still return the Wikipedia data without raising.
    """
    fake_df = pd.DataFrame([
        {"Symbol": "AAPL", "Security": "Apple", "GICS Sector": "Technology"},
    ])

    with (
        patch("app.services.universe.pd.read_html", return_value=[fake_df]),
        patch("app.services.universe._STATIC_CSV", Path("/nonexistent/path/sp500.csv")),
    ):
        result = load_sp500_symbols()  # must not raise

    assert result[0]["symbol"] == "AAPL"
