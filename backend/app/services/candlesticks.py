"""
Candlestick pattern recognition (M20) — a curated set of TA-Lib `CDL*` patterns
exposed as boolean rule-engine variables.

Each pattern yields a latest-bar variable (`cdl_hammer`) and a "within the last
RECENT_BARS bars" variable (`cdl_hammer_5d`). Two-sided patterns split by
direction (`cdl_engulfing_bull` / `cdl_engulfing_bear`). Adding a pattern is one
entry in CURATED_PATTERNS — storage is sparse jsonb, so no migration.

Detection is on daily candles. Pattern length is fixed by each pattern (1–3
bars); TA-Lib judges "long body", "small shadow" etc. against its standard
rolling averages of recent candles (~5–10 bars), so ~15 bars of history suffice.

Public API:
    RECENT_BARS                 int
    CURATED_PATTERNS            list[dict]  (one per TA-Lib pattern)
    PATTERN_VARIABLES           list[dict]  (one per latest-bar variable)
    PATTERN_VARIABLE_NAMES      frozenset[str]  (latest + recent variants)
    compute_patterns(df)        -> dict[str, bool]  (only the keys that fired)
"""

import logging

import numpy as np
import talib

logger = logging.getLogger(__name__)

# "Recent" window for the `_5d` variants (trading bars, including the latest).
# The universe refreshes weekly, so this covers the whole trading week.
RECENT_BARS = 5
RECENT_SUFFIX = "_5d"

# Fewer bars than this and TA-Lib's candle-size averages aren't meaningful.
MIN_PATTERN_BARS = 15

# direction: "bullish" / "bearish" / "neutral" fire on any non-zero TA-Lib output;
# "both" splits into _bull (> 0) and _bear (< 0) variables.
CURATED_PATTERNS: list[dict] = [
    # --- Bullish reversal ---
    {"key": "hammer", "fn": "CDLHAMMER", "label": "Hammer", "direction": "bullish",
     "meaning": "Small body at the top, long lower shadow, after a decline: sellers pushed down but buyers took it back. Possible bottom."},
    {"key": "inverted_hammer", "fn": "CDLINVERTEDHAMMER", "label": "Inverted Hammer", "direction": "bullish",
     "meaning": "Small body at the bottom, long upper shadow, after a decline: buyers are starting to test higher. Needs confirmation."},
    {"key": "dragonfly_doji", "fn": "CDLDRAGONFLYDOJI", "label": "Dragonfly Doji", "direction": "bullish",
     "meaning": "Open, high and close at the same level with a long lower shadow: a strong rejection of lower prices."},
    {"key": "morning_star", "fn": "CDLMORNINGSTAR", "label": "Morning Star", "direction": "bullish",
     "meaning": "Three bars: a long down candle, a small indecisive one, then a strong up candle. A classic bottom reversal."},
    {"key": "piercing", "fn": "CDLPIERCING", "label": "Piercing Line", "direction": "bullish",
     "meaning": "A down candle followed by an up candle that opens lower but closes above the midpoint of the first. Buyers stepping in."},
    {"key": "three_white_soldiers", "fn": "CDL3WHITESOLDIERS", "label": "Three White Soldiers", "direction": "bullish",
     "meaning": "Three long up candles, each closing near its high and higher than the last. Strong, steady buying."},
    # --- Bearish reversal ---
    {"key": "hanging_man", "fn": "CDLHANGINGMAN", "label": "Hanging Man", "direction": "bearish",
     "meaning": "Hammer shape after a rally: selling appeared intraday even though price recovered. Possible top."},
    {"key": "shooting_star", "fn": "CDLSHOOTINGSTAR", "label": "Shooting Star", "direction": "bearish",
     "meaning": "Small body at the bottom, long upper shadow, after a rally: buyers pushed up but sellers took it back. Possible top."},
    {"key": "gravestone_doji", "fn": "CDLGRAVESTONEDOJI", "label": "Gravestone Doji", "direction": "bearish",
     "meaning": "Open, low and close at the same level with a long upper shadow: a strong rejection of higher prices."},
    {"key": "evening_star", "fn": "CDLEVENINGSTAR", "label": "Evening Star", "direction": "bearish",
     "meaning": "Three bars: a long up candle, a small indecisive one, then a strong down candle. A classic top reversal."},
    {"key": "dark_cloud_cover", "fn": "CDLDARKCLOUDCOVER", "label": "Dark Cloud Cover", "direction": "bearish",
     "meaning": "An up candle followed by a down candle that opens higher but closes below the midpoint of the first. Sellers stepping in."},
    {"key": "three_black_crows", "fn": "CDL3BLACKCROWS", "label": "Three Black Crows", "direction": "bearish",
     "meaning": "Three long down candles, each closing near its low and lower than the last. Strong, steady selling."},
    # --- Two-sided ---
    {"key": "engulfing", "fn": "CDLENGULFING", "label": "Engulfing", "direction": "both",
     "meaning": "The candle's body completely covers the previous candle's body in the opposite direction. A strong reversal signal."},
    {"key": "harami", "fn": "CDLHARAMI", "label": "Harami", "direction": "both",
     "meaning": "A small body contained inside the previous candle's large body: momentum is stalling. Possible reversal."},
    {"key": "marubozu", "fn": "CDLMARUBOZU", "label": "Marubozu", "direction": "both",
     "meaning": "A long candle with little or no shadow: one side controlled the whole session."},
    # --- Neutral / indecision ---
    {"key": "doji", "fn": "CDLDOJI", "label": "Doji", "direction": "neutral",
     "meaning": "Open and close are nearly equal: indecision. Most meaningful after a strong move."},
    {"key": "spinning_top", "fn": "CDLSPINNINGTOP", "label": "Spinning Top", "direction": "neutral",
     "meaning": "Small body with shadows on both sides: indecision between buyers and sellers."},
]


def _variables() -> list[dict]:
    out = []
    for p in CURATED_PATTERNS:
        if p["direction"] == "both":
            for side, word in (("bull", "bullish"), ("bear", "bearish")):
                out.append({"name": f"cdl_{p['key']}_{side}", "label": f"{p['label']} ({word})",
                            "direction": word, "meaning": p["meaning"], "fn": p["fn"], "sign": 1 if side == "bull" else -1})
        else:
            out.append({"name": f"cdl_{p['key']}", "label": p["label"],
                        "direction": p["direction"], "meaning": p["meaning"], "fn": p["fn"], "sign": 0})
    return out


# One entry per latest-bar variable; each also has a RECENT_SUFFIX variant.
PATTERN_VARIABLES: list[dict] = _variables()
PATTERN_VARIABLE_NAMES: frozenset[str] = frozenset(
    name for v in PATTERN_VARIABLES for name in (v["name"], v["name"] + RECENT_SUFFIX)
)


def _fires(values: np.ndarray, sign: int) -> np.ndarray:
    if sign > 0:
        return values > 0
    if sign < 0:
        return values < 0
    return values != 0


def compute_patterns(df) -> dict[str, bool]:
    """
    Detect the curated patterns on a daily OHLC frame (columns Open/High/Low/
    Close, oldest → newest). Returns only the variables that fired, all True
    (sparse, as stored in indicator_snapshots.extra) — `{}` means computed,
    nothing fired. Too little history also returns `{}`.
    """
    if len(df) < MIN_PATTERN_BARS:
        return {}
    o, h, l, c = (df[col].to_numpy(dtype=np.float64) for col in ("Open", "High", "Low", "Close"))

    raw: dict[str, np.ndarray] = {}
    fired: dict[str, bool] = {}
    for v in PATTERN_VARIABLES:
        if v["fn"] not in raw:
            raw[v["fn"]] = getattr(talib, v["fn"])(o, h, l, c)
        hits = _fires(raw[v["fn"]], v["sign"])
        if hits[-1]:
            fired[v["name"]] = True
        if hits[-RECENT_BARS:].any():
            fired[v["name"] + RECENT_SUFFIX] = True
    return fired
