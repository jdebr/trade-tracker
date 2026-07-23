"""
Two-pass screener — pure DB rules engine.

Pass 1 — broad filter (no API calls, uses tickers table metadata):
  - avg_volume > 1,000,000
  - 15 ≤ last_price ≤ 500
  - is_etf = False

Pass 2 — signal filter (reads indicator_snapshots + ohlcv_cache):
  - bb_squeeze = True
  - 35 ≤ rsi_14 ≤ 65
  - close > ema_50  (above primary trend)
  - volume_expansion: avg(last 3d volume) > avg(last 20d volume)

Each passing signal adds 1 to signal_score (max 4).
Results are ranked by signal_score descending and written to screener_results.

No data fetching is performed here — run data refresh first via
POST /screener/refresh-data or the Saturday scheduled prefetch.

Public API:
    run_screener() -> tuple[datetime, list[dict]]
    get_latest_results(limit) -> list[dict]
    get_results_by_run(run_at_iso) -> list[dict]
"""

import logging
from collections import defaultdict
from datetime import datetime, timezone
from app.database import get_client
from app.services.feature_context import build_feature_contexts, snapshot_present
from app.services.rule_engine import RuleError, evaluate, extract_variables
from app.services import signal_rules as sr

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pass 1 thresholds
# ---------------------------------------------------------------------------

MIN_AVG_VOLUME = 1_000_000
MIN_PRICE      = 15.0
MAX_PRICE      = 500.0

# ---------------------------------------------------------------------------
# Pass 2 thresholds
# ---------------------------------------------------------------------------

RSI_LOW  = 35.0
RSI_HIGH = 65.0


# ---------------------------------------------------------------------------
# Pass 1
# ---------------------------------------------------------------------------

def pass1_filter() -> list[str]:
    """
    Query the tickers table and return symbols that pass all three criteria.
    Symbols with NULL avg_volume or last_price are excluded (not yet populated).
    Run data refresh first if this returns an empty list.
    """
    result = (
        get_client()
        .table("tickers")
        .select("symbol")
        .eq("is_etf", False)
        .gt("avg_volume", MIN_AVG_VOLUME)
        .gte("last_price", MIN_PRICE)
        .lte("last_price", MAX_PRICE)
        .execute()
    )
    symbols = [row["symbol"] for row in result.data]
    logger.info("Pass 1: %d survivors", len(symbols))
    return symbols


# ---------------------------------------------------------------------------
# Pass 2 helpers
# ---------------------------------------------------------------------------

def _get_recent_volumes(symbols: list[str]) -> dict[str, dict]:
    """
    For each symbol return avg of last 3d and last 20d volumes from ohlcv_cache.
    Result: {symbol: {"vol_3d": float, "vol_20d": float, "last_close": float}}

    Uses a single bulk query (.in_()) and groups by symbol in Python,
    instead of one round-trip per symbol.
    """
    if not symbols:
        return {}

    # Fetch up to 20 bars per symbol in one query — order by date desc so we
    # get the most-recent bars first.
    max_rows = len(symbols) * 20
    result = (
        get_client()
        .table("ohlcv_cache")
        .select("symbol,volume,close,date")
        .in_("symbol", symbols)
        .order("date", desc=True)
        .limit(max_rows)
        .execute()
    )

    # Group by symbol, keeping at most 20 rows each (already desc by date).
    grouped: dict[str, list] = defaultdict(list)
    for row in result.data:
        sym = row["symbol"]
        if len(grouped[sym]) < 20:
            grouped[sym].append(row)

    volumes: dict[str, dict] = {}
    for symbol, bars in grouped.items():
        if not bars:
            continue
        vols = [b["volume"] for b in bars]
        last_close = float(bars[0]["close"])
        vol_3d  = sum(vols[:3]) / min(3, len(vols))
        vol_20d = sum(vols)     / len(vols)
        volumes[symbol] = {
            "vol_3d":     vol_3d,
            "vol_20d":    vol_20d,
            "last_close": last_close,
        }
    return volumes


# ---------------------------------------------------------------------------
# Pass 2
# ---------------------------------------------------------------------------

def pass2_score(symbols: list[str]) -> list[dict]:
    """
    Score each symbol against the enabled signal rules (data-driven, via the M18
    engine) and return a list of candidate dicts sorted by signal_score descending.
    Symbols with no indicator snapshot are skipped.

    Dual-write: the four builtin signals are also surfaced as flat booleans
    (bb_squeeze / rsi_in_range / above_ema50 / volume_expansion) so the existing
    API response model and screener_results columns keep working unchanged.
    """
    rules = sr.get_enabled_rules()
    contexts = build_feature_contexts(symbols)

    candidates = []
    skipped_no_snap = 0
    for symbol in symbols:
        features = contexts.get(symbol) or {}
        if not snapshot_present(features):
            skipped_no_snap += 1
            logger.debug("%s: no indicator snapshot — skipping Pass 2", symbol)
            continue

        res = sr.evaluate_signals(features, rules)
        signals = res["signals"]

        candidates.append({
            "symbol":                  symbol,
            "signal_score":            res["signal_score"],
            "signal_score_normalized": res["signal_score_normalized"],
            "max_signal_score":        res["max_signal_score"],
            "signals":                 signals,
            "rsi_14":                  features.get("rsi_14"),
            "close_price":             features.get("close"),
            # Legacy flat booleans (dual-write) for the four builtin signals.
            "bb_squeeze":              signals.get("bb_squeeze"),
            "rsi_in_range":            signals.get("rsi_in_range"),
            "above_ema50":             signals.get("above_ema50"),
            "volume_expansion":        signals.get("volume_expansion"),
        })

    top_score = max((c["signal_score"] for c in candidates), default=0)
    logger.info(
        "Pass 2 scoring: %d symbols — %d had no snapshot, %d scored (top score: %d)",
        len(symbols), skipped_no_snap, len(candidates), top_score,
    )

    # Rank by score descending, then alphabetically as tiebreaker.
    candidates.sort(key=lambda c: (-c["signal_score"], c["symbol"]))
    for i, c in enumerate(candidates):
        c["rank"] = i + 1
    return candidates


# ---------------------------------------------------------------------------
# Rule preview against the full universe (builder aid, no persistence)
# ---------------------------------------------------------------------------

def preview_rule_over_universe(rule: dict) -> dict:
    """
    Evaluate a single candidate rule against the **current cached data** for the
    full Pass-1 universe and return the matching symbols + their rule-relevant
    feature values.

    Reuses the exact functions a real run uses (`pass1_filter` +
    `build_feature_contexts` + the M18 `evaluate`), so the universe and values are
    identical to what an actual scan would score. No external fetch and no
    indicator recompute — just the same cheap cache reads Pass 2 performs.

    The rule is evaluated in isolation ("which tickers does this fire on"), not as
    an addition to the enabled set. Symbols without a usable snapshot are skipped.
    Caller is expected to have validated the rule already.
    """
    symbols = pass1_filter()
    contexts = build_feature_contexts(symbols)
    vars_used = sorted(extract_variables(rule))

    matched: list[str] = []
    values: dict[str, dict] = {}
    evaluated = 0
    for sym in symbols:
        features = contexts.get(sym) or {}
        if not snapshot_present(features):
            continue
        evaluated += 1
        try:
            hit = bool(evaluate(rule, features))
        except RuleError:
            hit = False
        if hit:
            matched.append(sym)
            values[sym] = {v: features.get(v) for v in vars_used}

    matched.sort()
    logger.info(
        "Rule universe preview: %d matched of %d evaluated (%d Pass-1 survivors)",
        len(matched), evaluated, len(symbols),
    )
    return {
        "universe_count": len(symbols),
        "evaluated_count": evaluated,
        "match_count": len(matched),
        "matched": matched,
        "values": {s: values[s] for s in matched},
        "variables_used": vars_used,
    }


# ---------------------------------------------------------------------------
# Persist + retrieve
# ---------------------------------------------------------------------------

def save_results(candidates: list[dict], run_at: datetime) -> int:
    """
    Insert screener_results rows for this run.
    Returns the number of rows inserted.
    """
    if not candidates:
        return 0

    rows = []
    for c in candidates:
        signals = c.get("signals") or {}
        rows.append({
            "run_at":                  run_at.isoformat(),
            "symbol":                  c["symbol"],
            "rank":                    c["rank"],
            "signal_score":            c["signal_score"],
            "signals":                 signals,
            "signal_score_normalized": c.get("signal_score_normalized"),
            "max_signal_score":        c.get("max_signal_score"),
            "rsi_14":                  c.get("rsi_14"),
            "close_price":             c.get("close_price"),
            # Dual-write the four legacy boolean columns from the builtin results.
            "bb_squeeze":              signals.get("bb_squeeze"),
            "rsi_in_range":            signals.get("rsi_in_range"),
            "above_ema50":             signals.get("above_ema50"),
            "volume_expansion":        signals.get("volume_expansion"),
        })

    result = get_client().table("screener_results").insert(rows).execute()
    count = len(result.data) if result.data else 0
    logger.info("Saved %d screener_results rows for run_at=%s", count, run_at.isoformat())
    return count


def get_latest_results(limit: int = 50) -> list[dict]:
    """Return the most recent run's results, ordered by rank."""
    latest = (
        get_client()
        .table("screener_results")
        .select("run_at")
        .order("run_at", desc=True)
        .limit(1)
        .execute()
    )
    if not latest.data:
        return []

    run_at = latest.data[0]["run_at"]
    return _results_for_run(run_at, limit)


def get_results_by_run(run_at_iso: str, limit: int = 100) -> list[dict]:
    """Return results for a specific run identified by its run_at ISO string."""
    return _results_for_run(run_at_iso, limit)


def _results_for_run(run_at: str, limit: int) -> list[dict]:
    result = (
        get_client()
        .table("screener_results")
        .select("*")
        .eq("run_at", run_at)
        .order("rank")
        .limit(limit)
        .execute()
    )
    return result.data


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def run_screener() -> tuple[datetime, list[dict]]:
    """
    Pure DB screener run — no data fetching.

      1. Pass 1 — filter tickers table by volume/price metadata
      2. Pass 2 — score survivors against indicator snapshots
      3. Save results to screener_results

    Returns (run_at, candidates).  Returns (run_at, []) if no Pass 1 survivors —
    run data refresh first (POST /screener/refresh-data) to populate the cache.
    """
    run_at = datetime.now(timezone.utc)

    symbols = pass1_filter()
    if not symbols:
        logger.warning(
            "Pass 1 returned 0 survivors — cache may be empty. "
            "Run POST /screener/refresh-data to populate OHLCV and metadata."
        )
        return run_at, []

    candidates = pass2_score(symbols)
    save_results(candidates, run_at)

    return run_at, candidates
