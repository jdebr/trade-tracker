"""
Position persistence — opening, revising, closing, and the event log.

The model is a hybrid:
  positions        current state, denormalized so reports are a plain query
  position_events  append-only audit trail of everything that happened

Every state change writes an event. Events are never updated or deleted.

Public API:
    snapshot_entry_signals(symbol, ctx) -> dict
    record_event(position_id, event_type, ...) -> dict
    get_open_positions() -> list[dict]
    get_open_position_symbols() -> list[str]
    get_position(position_id) -> dict | None
    get_events(position_id) -> list[dict]
    close_position(position, exit_price, exit_date, exit_reason, notes) -> dict
"""

import logging
from datetime import date, datetime, timezone

from app.database import get_client
from app.services.exit_strategy import MarketContext, compute_outcome
from app.services.feature_context import features_from_context
from app.services import signal_rules as sr

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Signal attribution
# ---------------------------------------------------------------------------

def snapshot_entry_signals(
    symbol:            str,
    ctx:               MarketContext,
    triggering_alerts: list[str] | None = None,
) -> dict:
    """
    Capture the signal state at the moment of entry.

    This is the single most important field for the reporting slice: without it
    there is no way to ask "do BB-squeeze entries actually make money?" after the
    fact, because the indicator values will have moved on by the time the trade
    closes.

    `entry_signals["signals"]` holds {slug: bool} for *every enabled signal rule*
    at the time of entry — the full dynamic set, not a frozen four — evaluated by
    the same M18 engine the screener uses, so a position's recorded signals mean
    exactly what the screener meant. The nested map keeps user-defined slugs from
    colliding with the raw-value keys below.
    """
    features = features_from_context(ctx)
    scored = sr.evaluate_signals(features, sr.get_enabled_rules())

    return {
        # The dynamic signal set — what the reports group by.
        "signals":                 scored["signals"],
        "signal_score":            scored["signal_score"],
        "signal_score_normalized": scored["signal_score_normalized"],
        "max_signal_score":        scored["max_signal_score"],

        # Raw values, for finer-grained analysis later.
        "rsi_14":    features.get("rsi_14"),
        "macd_hist": features.get("macd_hist"),
        "atr_14":    features.get("atr_14"),
        "bb_width":  features.get("bb_width"),
        "ema_8":     features.get("ema_8"),
        "ema_21":    features.get("ema_21"),
        "ema_50":    features.get("ema_50"),
        "close_at_entry": features.get("close"),

        # Which alert types were live on this symbol when the trade was opened.
        "triggering_alert_types": triggering_alerts or [],

        "snapshot_date": ctx.snapshot.get("date") if ctx.snapshot else None,
    }


def get_recent_alert_types(symbol: str, lookback_days: int = 3) -> list[str]:
    """Return opportunity alert types fired for this symbol in the last N days."""
    from datetime import timedelta
    cutoff = (date.today() - timedelta(days=lookback_days)).isoformat()
    result = (
        get_client()
        .table("alerts")
        .select("alert_type")
        .eq("symbol", symbol.upper())
        .eq("category", "opportunity")
        .gte("date", cutoff)
        .execute()
    )
    return sorted({row["alert_type"] for row in result.data})


# ---------------------------------------------------------------------------
# Event log
# ---------------------------------------------------------------------------

def record_event(
    position_id: str,
    event_type:  str,
    price:       float | None = None,
    payload:     dict | None = None,
    alert_id:    str | None = None,
) -> dict:
    """Append an event to a position's log. Append-only — never updated."""
    row = {
        "position_id": position_id,
        "event_type":  event_type,
        "price":       price,
        "payload":     payload or {},
        "alert_id":    alert_id,
    }
    result = get_client().table("position_events").insert(row).execute()
    logger.info("Position %s — event '%s' recorded", position_id, event_type)
    return result.data[0] if result.data else row


def get_events(position_id: str) -> list[dict]:
    """Return a position's full event log, oldest → newest."""
    result = (
        get_client()
        .table("position_events")
        .select("*")
        .eq("position_id", position_id)
        .order("occurred_at")
        .execute()
    )
    return result.data


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------

def get_open_positions() -> list[dict]:
    result = (
        get_client()
        .table("positions")
        .select("*")
        .eq("status", "open")
        .order("entry_date", desc=True)
        .execute()
    )
    return result.data


def get_open_position_symbols() -> list[str]:
    """
    Distinct symbols with an open position.

    These are NOT necessarily on the watchlist — you can hold a position in a
    name you have since removed from the watchlist. Any job that monitors
    positions must poll this union, not just the watchlist.
    """
    result = (
        get_client()
        .table("positions")
        .select("symbol")
        .eq("status", "open")
        .execute()
    )
    return sorted({row["symbol"] for row in result.data})


def get_position(position_id: str) -> dict | None:
    result = (
        get_client()
        .table("positions")
        .select("*")
        .eq("id", position_id)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


# ---------------------------------------------------------------------------
# Close
# ---------------------------------------------------------------------------

def close_position(
    position:    dict,
    exit_price:  float,
    exit_date:   date,
    exit_reason: str,
    notes:       str | None = None,
) -> dict:
    """
    Close a position: compute the outcome, update the row, log a `closed` event.

    R-multiple is computed against `initial_stop_price` — the risk actually taken
    when the trade was put on — not the current (possibly trailed) stop.
    """
    entry_price = float(position["entry_price"])
    shares      = float(position["shares"])
    initial_stop = float(position["initial_stop_price"])
    entry_date  = date.fromisoformat(str(position["entry_date"]))

    outcome   = compute_outcome(entry_price, exit_price, shares, initial_stop)
    hold_days = (exit_date - entry_date).days

    updates = {
        "status":      "closed",
        "exit_price":  exit_price,
        "exit_date":   exit_date.isoformat(),
        "exit_reason": exit_reason,
        "pnl":         outcome["pnl"],
        "pnl_pct":     outcome["pnl_pct"],
        "r_multiple":  outcome["r_multiple"],
        "hold_days":   hold_days,
        "updated_at":  datetime.now(timezone.utc).isoformat(),
    }
    if notes:
        updates["notes"] = notes

    result = (
        get_client()
        .table("positions")
        .update(updates)
        .eq("id", position["id"])
        .execute()
    )

    record_event(
        position_id=position["id"],
        event_type="closed",
        price=exit_price,
        payload={
            "exit_reason": exit_reason,
            "pnl":         outcome["pnl"],
            "pnl_pct":     outcome["pnl_pct"],
            "r_multiple":  outcome["r_multiple"],
            "hold_days":   hold_days,
        },
    )

    logger.info(
        "Closed position %s (%s) — %s at %.2f, P&L %.2f (%.2fR)",
        position["id"], position["symbol"], exit_reason, exit_price,
        outcome["pnl"], outcome["r_multiple"] or 0,
    )

    return result.data[0] if result.data else {**position, **updates}
