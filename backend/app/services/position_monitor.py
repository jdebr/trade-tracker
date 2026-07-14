"""
Position monitor — watches OPEN positions and fires alerts when the exit plan
is triggered.

This is the counterpart to intraday.py. Where the intraday poller asks "is this
watchlist symbol showing an opportunity?", this asks "has a trade I am actually
in hit its stop or target?". Both write to the `alerts` table, separated by the
`category` column:

    category = 'opportunity'   screener / scanner / intraday — "here's an idea"
    category = 'position'      stop hit, target hit — "act on a trade you hold"

Alert types generated (all category='position'):
    target_hit          price >= target_price
    stop_hit            price <= stop_price
    approaching_target  price within APPROACHING_TARGET% of target
    trailing_stop_moved trailing stop ratcheted up (also updates positions.stop_price)
    time_stop_reached   held past time_stop_date without resolving

Dedup key is (position_id, alert_type, date) — NOT (symbol, alert_type). Two
positions can exist on one symbol, and each needs its own alerts.

Public API:
    evaluate_position_conditions(...) -> tuple[list[dict], int]
    apply_trailing_stop(position, ctx) -> float | None
    run_position_monitor(prices) -> dict
"""

import logging
from datetime import date, datetime, timezone

from app.database import get_client
from app.services import positions as pos_svc
from app.services.exit_strategy import (
    APPROACHING_TARGET,
    compute_trailing_stop,
    load_market_context,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Dedup
# ---------------------------------------------------------------------------

def _get_existing_position_alerts_today(
    position_ids: list[str], today: date
) -> set[tuple[str, str]]:
    """
    Return (position_id, alert_type) pairs already fired today.

    Keyed on position_id rather than symbol: if you somehow hold two positions in
    the same name, a stop hit on one must not suppress the alert on the other.
    """
    if not position_ids:
        return set()

    result = (
        get_client()
        .table("alerts")
        .select("position_id,alert_type")
        .in_("position_id", position_ids)
        .eq("category", "position")
        .eq("date", today.isoformat())
        .execute()
    )
    return {(row["position_id"], row["alert_type"]) for row in result.data}


# ---------------------------------------------------------------------------
# Condition evaluation (exported for unit tests)
# ---------------------------------------------------------------------------

def evaluate_position_conditions(
    position:      dict,
    current_price: float,
    existing:      set[tuple[str, str]],
    today:         date,
) -> tuple[list[dict], int]:
    """
    Evaluate exit conditions for one open position against the current price.

    Returns (new_alerts, skipped_count). Alerts are deduped against `existing`.

    Note this does NOT close the position — it only raises the alert. Closing is
    always a deliberate act by the user, because the app has no broker connection
    and cannot know the real fill price. Auto-closing on a stop touch would invent
    a fill that never happened and quietly corrupt the performance record.
    """
    position_id = position["id"]
    symbol      = position["symbol"]

    stop_price     = float(position["stop_price"])
    target_price   = float(position["target_price"]) if position.get("target_price") else None
    entry_price    = float(position["entry_price"])
    risk_per_share = float(position["risk_per_share"])
    time_stop_date = position.get("time_stop_date")

    alerts:  list[dict] = []
    skipped: int        = 0

    # Unrealized R at the moment of the alert — the single most useful number to
    # see on the card, and it costs nothing to compute here.
    unrealized_r = (current_price - entry_price) / risk_per_share if risk_per_share > 0 else None

    def _add(alert_type: str, details: dict) -> None:
        nonlocal skipped
        if (position_id, alert_type) in existing:
            skipped += 1
            return
        alerts.append({
            "symbol":           symbol,
            "date":             today.isoformat(),
            "alert_type":       alert_type,
            "category":         "position",
            "position_id":      position_id,
            "price_at_trigger": current_price,
            "details": {
                **details,
                "entry_price":     entry_price,
                "is_simulated":    position["is_simulated"],
                "unrealized_r":    round(unrealized_r, 2) if unrealized_r is not None else None,
            },
            "acknowledged": False,
        })

    # --- Stop hit -----------------------------------------------------------
    if current_price <= stop_price:
        _add("stop_hit", {
            "stop_price": stop_price,
            "loss_per_share": round(current_price - entry_price, 4),
        })

    # --- Target hit ---------------------------------------------------------
    elif target_price is not None and current_price >= target_price:
        _add("target_hit", {
            "target_price": target_price,
            "gain_per_share": round(current_price - entry_price, 4),
        })

    # --- Approaching target -------------------------------------------------
    # Only when the target has NOT been hit — otherwise both would fire on the
    # same tick and the "approaching" alert would be pure noise.
    elif target_price is not None:
        distance_pct = (target_price - current_price) / target_price * 100
        if 0 < distance_pct <= APPROACHING_TARGET:
            _add("approaching_target", {
                "target_price": target_price,
                "distance_pct": round(distance_pct, 2),
            })

    # --- Time stop ----------------------------------------------------------
    # Independent of the price conditions above: a trade can be both drifting
    # sideways and past its time stop.
    if time_stop_date and date.fromisoformat(str(time_stop_date)) <= today:
        _add("time_stop_reached", {
            "time_stop_date": str(time_stop_date),
            "hold_days": (today - date.fromisoformat(str(position["entry_date"]))).days,
        })

    return alerts, skipped


# ---------------------------------------------------------------------------
# Trailing stop
# ---------------------------------------------------------------------------

def apply_trailing_stop(position: dict, current_price: float) -> dict | None:
    """
    Recompute the chandelier trailing stop for a position and persist it if it
    moved up.

    Returns {"old_stop", "new_stop"} if the stop moved, else None.

    The highest high since entry is read from the OHLCV cache and compared
    against the current price, so an intraday spike above the last close still
    counts. compute_trailing_stop() enforces the ratchet — it returns None if the
    candidate stop would move down.
    """
    exit_plan = position.get("exit_plan") or {}
    if not exit_plan.get("trail_enabled"):
        return None

    trail_mult = float(exit_plan.get("trail_atr_mult", 3.0))

    ctx = load_market_context(position["symbol"])
    atr = ctx.indicator("atr_14")
    if atr is None:
        logger.debug("No ATR for %s — cannot trail stop", position["symbol"])
        return None

    entry_date = date.fromisoformat(str(position["entry_date"]))
    highs = [
        float(bar["high"])
        for bar in ctx.bars
        if date.fromisoformat(str(bar["date"])) >= entry_date
    ]
    highest_high = max(highs + [current_price]) if highs else current_price

    current_stop = float(position["stop_price"])
    new_stop = compute_trailing_stop(current_stop, highest_high, atr, trail_mult)
    if new_stop is None:
        return None

    get_client().table("positions").update({
        "stop_price": round(new_stop, 4),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", position["id"]).execute()

    pos_svc.record_event(
        position_id=position["id"],
        event_type="stop_moved",
        price=current_price,
        payload={
            "old_stop":     current_stop,
            "new_stop":     round(new_stop, 4),
            "highest_high": round(highest_high, 4),
            "atr_14":       atr,
            "trail_atr_mult": trail_mult,
            "source":       "trailing_stop",
        },
    )

    logger.info(
        "Trailed stop for %s (%s): %.2f → %.2f",
        position["symbol"], position["id"], current_stop, new_stop,
    )
    return {"old_stop": current_stop, "new_stop": round(new_stop, 4)}


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def run_position_monitor(prices: dict[str, float]) -> dict:
    """
    Evaluate every open position against a price map and insert the alerts.

    `prices` is passed in rather than fetched here so this can share a single
    quote fetch with the intraday poller — the two run back-to-back and would
    otherwise double the API calls for every symbol they have in common.

    Positions whose symbol is missing from `prices` are skipped (the quote fetch
    failed for that symbol); they will be picked up on the next poll.
    """
    started_at = datetime.now(timezone.utc)
    today      = date.today()

    open_positions = pos_svc.get_open_positions()
    if not open_positions:
        return {
            "positions_monitored": 0, "alerts_created": 0,
            "alerts_skipped": 0, "stops_trailed": 0,
            "started_at": started_at.isoformat(),
        }

    existing = _get_existing_position_alerts_today(
        [p["id"] for p in open_positions], today,
    )

    new_alerts:    list[dict] = []
    total_skipped: int        = 0
    stops_trailed: int        = 0
    monitored:     int        = 0

    for position in open_positions:
        price = prices.get(position["symbol"])
        if price is None:
            logger.debug(
                "No price for %s — skipping position %s this cycle",
                position["symbol"], position["id"],
            )
            continue
        monitored += 1

        # Trail the stop BEFORE evaluating conditions, so a stop that just
        # ratcheted up is the one the stop_hit check uses this cycle.
        try:
            moved = apply_trailing_stop(position, price)
            if moved:
                stops_trailed += 1
                position = {**position, "stop_price": moved["new_stop"]}
        except Exception as exc:
            logger.error(
                "Trailing stop failed for position %s: %s",
                position["id"], exc, exc_info=True,
            )

        fired, skipped = evaluate_position_conditions(
            position=position,
            current_price=price,
            existing=existing,
            today=today,
        )
        new_alerts.extend(fired)
        total_skipped += skipped

    if new_alerts:
        get_client().table("alerts").insert(new_alerts).execute()

    logger.info(
        "Position monitor complete — %d monitored, %d alert(s) created, "
        "%d dedup-skipped, %d stop(s) trailed",
        monitored, len(new_alerts), total_skipped, stops_trailed,
    )

    return {
        "positions_monitored": monitored,
        "alerts_created":      len(new_alerts),
        "alerts_skipped":      total_skipped,
        "stops_trailed":       stops_trailed,
        "started_at":          started_at.isoformat(),
    }
