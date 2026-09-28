"""
Feature context — the per-symbol variable dictionary the rule engine reads.

`VARIABLE_REGISTRY` is the single source of truth for every variable a rule may
reference: it drives validation (the set of known names), the builder UI, and
tooltips. `build_feature_context` flattens the latest indicator snapshot plus
recent OHLCV into that flat `{name: value}` map, deriving `close`, `vol_3d`, and
`vol_20d` exactly as the screener and position-entry code do today.

Later milestones extend this by appending registry entries and populating the
matching keys here (M20 candlestick flags, M22 new indicators) — the rule engine
itself never changes.

Public API:
    VARIABLE_REGISTRY               list[dict]
    VARIABLE_NAMES                  frozenset[str]
    VARIABLE_LABELS                 dict[str, str]
    build_feature_context(symbol)   -> dict
    build_feature_contexts(symbols) -> dict[str, dict]
"""

import logging
from datetime import date, timedelta

from app.services.candlesticks import (
    PATTERN_VARIABLE_NAMES, PATTERN_VARIABLES, RECENT_BARS, RECENT_SUFFIX,
)
from app.services.indicator_cache import get_latest_snapshots
from app.services.ohlcv_cache import get_cached_bars, get_ohlcv_summary

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Variable registry
# ---------------------------------------------------------------------------

VARIABLE_REGISTRY: list[dict] = [
    {"name": "rsi_14", "type": "number", "label": "RSI(14)", "group": "momentum",
     "description": "Relative Strength Index (14) — momentum oscillator, 0–100."},
    {"name": "macd_line", "type": "number", "label": "MACD Line", "group": "momentum",
     "description": "MACD line (12/26 EMA difference)."},
    {"name": "macd_signal", "type": "number", "label": "MACD Signal", "group": "momentum",
     "description": "MACD signal line (9-EMA of the MACD line)."},
    {"name": "macd_hist", "type": "number", "label": "MACD Histogram", "group": "momentum",
     "description": "MACD line minus signal line."},
    {"name": "bb_upper", "type": "number", "label": "BB Upper", "group": "volatility",
     "description": "Bollinger upper band (20/2)."},
    {"name": "bb_middle", "type": "number", "label": "BB Middle", "group": "volatility",
     "description": "Bollinger middle band (20-period SMA)."},
    {"name": "bb_lower", "type": "number", "label": "BB Lower", "group": "volatility",
     "description": "Bollinger lower band (20/2)."},
    {"name": "bb_width", "type": "number", "label": "BB Width", "group": "volatility",
     "description": "Normalized Bollinger band width, (upper − lower) / middle."},
    {"name": "bb_squeeze", "type": "boolean", "label": "BB Squeeze", "group": "volatility",
     "description": "True when BB width is in the bottom 20th percentile of its trailing 252-day range."},
    {"name": "ema_8", "type": "number", "label": "EMA 8", "group": "trend",
     "description": "8-day exponential moving average of close."},
    {"name": "ema_21", "type": "number", "label": "EMA 21", "group": "trend",
     "description": "21-day exponential moving average of close."},
    {"name": "ema_50", "type": "number", "label": "EMA 50", "group": "trend",
     "description": "50-day exponential moving average of close."},
    {"name": "atr_14", "type": "number", "label": "ATR(14)", "group": "volatility",
     "description": "Average True Range (14) — volatility in price units."},
    {"name": "obv", "type": "number", "label": "OBV", "group": "volume",
     "description": "On-Balance Volume — cumulative volume flow."},
    {"name": "close", "type": "number", "label": "Close", "group": "price",
     "description": "Most recent daily closing price."},
    {"name": "vol_3d", "type": "number", "label": "Volume (3d avg)", "group": "volume",
     "description": "Average daily volume over the last 3 trading days."},
    {"name": "vol_20d", "type": "number", "label": "Volume (20d avg)", "group": "volume",
     "description": "Average daily volume over the last 20 trading days."},
]

# M20 candlestick patterns: a latest-bar and a recent-window variable each.
VARIABLE_REGISTRY += [
    {"name": v["name"], "type": "boolean", "label": v["label"], "group": "candlesticks · latest bar",
     "direction": v["direction"],
     "description": f"{v['direction'].capitalize()} pattern on the latest daily candle. {v['meaning']}"}
    for v in PATTERN_VARIABLES
] + [
    {"name": v["name"] + RECENT_SUFFIX, "type": "boolean", "label": f"{v['label']} (last {RECENT_BARS} bars)",
     "group": f"candlesticks · last {RECENT_BARS} bars", "direction": v["direction"],
     "description": f"{v['direction'].capitalize()} pattern on any of the last {RECENT_BARS} daily candles. {v['meaning']}"}
    for v in PATTERN_VARIABLES
]

VARIABLE_NAMES: frozenset[str] = frozenset(e["name"] for e in VARIABLE_REGISTRY)
VARIABLE_LABELS: dict[str, str] = {e["name"]: e["label"] for e in VARIABLE_REGISTRY}

# Variables sourced directly from an indicator_snapshots row.
_SNAPSHOT_FIELDS = (
    "rsi_14", "macd_line", "macd_signal", "macd_hist",
    "bb_upper", "bb_middle", "bb_lower", "bb_width", "bb_squeeze",
    "ema_8", "ema_21", "ema_50", "atr_14", "obv",
)
_BOOLEAN_FIELDS = frozenset({"bb_squeeze"})

# Number of trailing bars used for the volume averages.
_VOL_WINDOW = 20


def _coerce(name: str, value):
    if value is None:
        return None
    if name in _BOOLEAN_FIELDS:
        return bool(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _bar_stats(bars: list[dict]) -> dict:
    """close / vol_3d / vol_20d from OHLCV bars (oldest→newest).

    Volume averages always use the trailing `_VOL_WINDOW` bars regardless of how many
    are supplied — callers may pass more (e.g. the 60 bars a MarketContext loads), and
    vol_20d must remain a 20-day average to match the screener.
    """
    window = bars[-_VOL_WINDOW:]
    if not window:
        return {"close": None, "vol_3d": None, "vol_20d": None}
    vols = [b["volume"] for b in window]
    return {
        "close": float(window[-1]["close"]),
        "vol_3d": sum(vols[-3:]) / min(3, len(vols)),
        "vol_20d": sum(vols) / len(vols),
    }


def _pattern_flags(snapshot: dict) -> dict:
    """Candlestick variables from the snapshot's sparse `extra`: stored keys are
    the ones that fired, so a computed row fills the rest as False. A row whose
    patterns were never computed (`extra` NULL) gives None, so rules on them
    don't fire on missing data."""
    extra = snapshot.get("extra")
    if extra is None:
        return dict.fromkeys(PATTERN_VARIABLE_NAMES)
    return {name: bool(extra.get(name, False)) for name in PATTERN_VARIABLE_NAMES}


def _assemble_stats(snapshot: dict, stats: dict) -> dict:
    ctx = {name: _coerce(name, snapshot.get(name)) for name in _SNAPSHOT_FIELDS}
    ctx.update(_pattern_flags(snapshot))
    ctx["close"] = stats.get("close")
    ctx["vol_3d"] = stats.get("vol_3d")
    ctx["vol_20d"] = stats.get("vol_20d")
    return ctx


def _assemble(snapshot: dict, bars: list[dict]) -> dict:
    """Build the flat variable dict from one snapshot row + OHLCV bars (oldest→newest)."""
    return _assemble_stats(snapshot, _bar_stats(bars))


def build_feature_context(symbol: str) -> dict:
    """Assemble the feature dict for a single symbol."""
    sym = symbol.upper()
    snaps = get_latest_snapshots([sym])
    snapshot = snaps[0] if snaps else {}
    bars = get_cached_bars(sym, limit=_VOL_WINDOW)
    return _assemble(snapshot, bars)


def features_from(snapshot: dict | None, bars: list[dict]) -> dict:
    """Feature dict from an already-loaded snapshot + bars (oldest→newest), no queries."""
    return _assemble(snapshot or {}, bars)


def features_from_context(ctx) -> dict:
    """
    Build the feature dict from an already-loaded MarketContext (exit_strategy),
    reusing its snapshot + bars instead of re-querying — used at position entry.
    """
    return _assemble(ctx.snapshot or {}, ctx.bars or [])


def snapshot_present(features: dict) -> bool:
    """True if the feature dict came from a real indicator snapshot (not all-None)."""
    return any(features.get(name) is not None for name in _SNAPSHOT_FIELDS)


def _summary_stats(summary: dict | None) -> dict:
    """close / vol_3d / vol_20d from one `get_ohlcv_summary` row."""
    if not summary:
        return {"close": None, "vol_3d": None, "vol_20d": None}
    return {"close": summary["last_close"], "vol_3d": summary["vol_3d"], "vol_20d": summary["vol_avg"]}


def _is_stale(snapshot: dict, max_age_days: int | None) -> bool:
    if max_age_days is None or not snapshot.get("date"):
        return False
    return date.fromisoformat(snapshot["date"]) < date.today() - timedelta(days=max_age_days)


def build_feature_contexts(
    symbols: list[str], max_snapshot_age_days: int | None = None
) -> dict[str, dict]:
    """
    Assemble feature dicts for many symbols with one snapshot + one OHLCV-summary
    call (each returns one row per symbol, so neither can be truncated).

    With `max_snapshot_age_days`, snapshots older than that are treated as missing
    (all snapshot variables None → `snapshot_present` is False), so scoring skips
    tickers whose data has stopped updating instead of scoring them on old values.
    """
    syms = [s.upper() for s in symbols]
    if not syms:
        return {}
    snaps = {s["symbol"]: s for s in get_latest_snapshots(syms)}
    stale = [sym for sym, snap in snaps.items() if _is_stale(snap, max_snapshot_age_days)]
    for sym in stale:
        del snaps[sym]
    if stale:
        logger.info(
            "Ignoring %d snapshot(s) older than %d days: %s",
            len(stale), max_snapshot_age_days, ", ".join(sorted(stale)),
        )
    summary = get_ohlcv_summary(syms, window=_VOL_WINDOW)
    return {
        sym: _assemble_stats(snaps.get(sym, {}), _summary_stats(summary.get(sym)))
        for sym in syms
    }
