import logging
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.database import get_client
from app.models.positions import (
    ExitPlanRequest,
    ExitPlanResponse,
    Position,
    PositionClose,
    PositionDetail,
    PositionOpen,
    PositionUpdate,
)
from app.services import positions as pos_svc
from app.services import settings as settings_svc
from app.services.exit_strategy import (
    ExitPlanError,
    build_exit_plan,
    load_market_context,
)
from app.services.ohlcv_cache import get_latest_closes

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/positions", tags=["positions"])


# ---------------------------------------------------------------------------
# Exit strategy builder — pure calculation, nothing is persisted.
#
# Declared before the /{position_id} routes so "plan" is never swallowed by the
# path parameter.
# ---------------------------------------------------------------------------

@router.post("/plan", response_model=ExitPlanResponse)
def plan_exit(body: ExitPlanRequest):
    """
    Compute stop, target, position size, and risk for a prospective trade.

    This is the what-if endpoint behind the exit strategy builder — the UI calls
    it on every input change. It writes nothing.

    Returns the recommended plan plus every alternative stop and target level
    computed side by side, so the levels can be compared rather than accepted
    on faith.
    """
    ctx      = load_market_context(body.symbol)
    settings = settings_svc.get_settings()

    if ctx.snapshot is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No indicator data for {body.symbol.upper()}. "
                f"Run a scan (POST /scheduler/trigger) or a data refresh first."
            ),
        )

    try:
        plan = build_exit_plan(
            symbol=body.symbol,
            entry_price=body.entry_price,
            ctx=ctx,
            settings=settings,
            stop_method=body.stop_method,
            target_method=body.target_method,
            atr_mult=body.atr_mult,
            stop_pct=body.stop_pct,
            target_r=body.target_r,
            target_pct=body.target_pct,
            manual_stop=body.manual_stop,
            manual_target=body.manual_target,
            account_size=body.account_size,
            risk_pct=body.risk_pct,
            direction=body.direction,
            entry_date=body.entry_date,
        )
    except ExitPlanError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return plan.to_dict()


@router.get("/quotes")
def get_position_quotes() -> dict[str, float]:
    """
    Latest cached close for every symbol with an open position.

    The Positions page needs a current price to show unrealized R, and
    indicator_snapshots has no close column — so it comes from ohlcv_cache here in
    one round trip rather than a fetch per position.

    Declared before /{position_id} so "quotes" is not read as a position id.
    """
    return get_latest_closes(pos_svc.get_open_position_symbols())


# ---------------------------------------------------------------------------
# List / open
# ---------------------------------------------------------------------------

@router.get("", response_model=list[Position])
def list_positions(
    status:       Optional[str]  = Query(None, pattern="^(open|closed|cancelled)$"),
    is_simulated: Optional[bool] = Query(None),
    symbol:       Optional[str]  = Query(None),
    limit:        int            = Query(100, ge=1, le=500),
):
    """List positions, newest first. Filter by status, simulated flag, or symbol."""
    query = get_client().table("positions").select("*")

    if status is not None:
        query = query.eq("status", status)
    if is_simulated is not None:
        query = query.eq("is_simulated", is_simulated)
    if symbol is not None:
        query = query.eq("symbol", symbol.upper())

    result = query.order("entry_date", desc=True).limit(limit).execute()
    return result.data


@router.post("", response_model=Position, status_code=201)
def open_position(body: PositionOpen):
    """
    Open a position.

    Risk figures are recomputed server-side from (entry, stop, shares) rather
    than trusted from the client, so the stored R denominator always matches the
    stored prices.

    `initial_stop_price` is frozen here and never changes again — it is the
    denominator of every R-multiple this trade will ever report.
    """
    symbol     = body.symbol.upper()
    entry_date = body.entry_date or date.today()

    risk_per_share = body.entry_price - body.stop_price
    if risk_per_share <= 0:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Stop ({body.stop_price:.2f}) must be below the entry price "
                f"({body.entry_price:.2f}) for a long position."
            ),
        )

    # Capture the indicator state at entry — this is what the reports group by.
    ctx = load_market_context(symbol)
    entry_signals = pos_svc.snapshot_entry_signals(
        symbol,
        ctx,
        triggering_alerts=pos_svc.get_recent_alert_types(symbol),
    )

    row = {
        "symbol":             symbol,
        "direction":          body.direction,
        "is_simulated":       body.is_simulated,
        "status":             "open",
        "alert_id":           body.alert_id,
        "screener_result_id": body.screener_result_id,
        "entry_date":         entry_date.isoformat(),
        "entry_price":        body.entry_price,
        "shares":             body.shares,
        "position_value":     round(body.entry_price * body.shares, 4),
        "initial_stop_price": body.stop_price,
        "stop_price":         body.stop_price,
        "target_price":       body.target_price,
        "stop_method":        body.stop_method,
        "target_method":      body.target_method,
        "exit_plan":          body.exit_plan,
        "time_stop_date":     body.time_stop_date.isoformat() if body.time_stop_date else None,
        "risk_per_share":     round(risk_per_share, 4),
        "risk_amount":        round(risk_per_share * body.shares, 4),
        "entry_signals":      entry_signals,
        "notes":              body.notes,
    }

    try:
        result = get_client().table("positions").insert(row).execute()
    except Exception as exc:
        # Most likely cause: the symbol isn't in the tickers universe (FK violation).
        logger.error("Failed to open position for %s: %s", symbol, exc)
        raise HTTPException(
            status_code=400,
            detail=(
                f"Could not open position for {symbol}. "
                f"Confirm the symbol exists in the ticker universe."
            ),
        )

    position = result.data[0]

    pos_svc.record_event(
        position_id=position["id"],
        event_type="opened",
        price=body.entry_price,
        payload={
            "shares":         body.shares,
            "stop_price":     body.stop_price,
            "target_price":   body.target_price,
            "risk_amount":    row["risk_amount"],
            "is_simulated":   body.is_simulated,
            "entry_signals":  entry_signals,
            "exit_plan":      body.exit_plan,
        },
        alert_id=body.alert_id,
    )

    logger.info(
        "Opened %s position: %s %.4f shares @ %.2f, stop %.2f, risk $%.2f",
        "SIMULATED" if body.is_simulated else "LIVE",
        symbol, body.shares, body.entry_price, body.stop_price, row["risk_amount"],
    )
    return position


# ---------------------------------------------------------------------------
# Detail / update / close / delete
# ---------------------------------------------------------------------------

@router.get("/{position_id}", response_model=PositionDetail)
def get_position(position_id: str):
    """Return a position with its full event log."""
    position = pos_svc.get_position(position_id)
    if not position:
        raise HTTPException(status_code=404, detail=f"Position {position_id} not found")

    return {**position, "events": pos_svc.get_events(position_id)}


@router.patch("/{position_id}", response_model=Position)
def update_position(position_id: str, body: PositionUpdate):
    """
    Revise an open position's plan.

    A stop or target change is logged as an event so the history of how the plan
    evolved survives. Note that `initial_stop_price` is deliberately not
    touchable — moving it would retroactively rewrite the trade's R-multiple.
    """
    position = pos_svc.get_position(position_id)
    if not position:
        raise HTTPException(status_code=404, detail=f"Position {position_id} not found")
    if position["status"] != "open":
        raise HTTPException(
            status_code=400,
            detail=f"Position is {position['status']} — only open positions can be revised.",
        )

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    if "time_stop_date" in updates:
        updates["time_stop_date"] = updates["time_stop_date"].isoformat()

    if "stop_price" in updates and updates["stop_price"] >= float(position["entry_price"]):
        # A stop at or above entry on a long is almost always a typo. (Raising a
        # stop above entry to lock in a gain is a real strategy, but it breaks the
        # risk_per_share > 0 invariant, so it needs its own handling — not v1.)
        raise HTTPException(
            status_code=400,
            detail=(
                f"Stop ({updates['stop_price']:.2f}) must be below the entry price "
                f"({float(position['entry_price']):.2f})."
            ),
        )

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    result = (
        get_client()
        .table("positions")
        .update(updates)
        .eq("id", position_id)
        .execute()
    )

    # Log the plan change. A stop move gets its own event type — it's the one
    # revision that materially changes the trade's risk.
    if "stop_price" in updates:
        pos_svc.record_event(
            position_id=position_id,
            event_type="stop_moved",
            price=updates["stop_price"],
            payload={
                "old_stop": float(position["stop_price"]),
                "new_stop": updates["stop_price"],
                "source":   "manual",
            },
        )
    if "target_price" in updates or "time_stop_date" in updates:
        pos_svc.record_event(
            position_id=position_id,
            event_type="plan_revised",
            payload={k: v for k, v in updates.items() if k != "updated_at"},
        )

    return result.data[0]


@router.post("/{position_id}/close", response_model=Position)
def close_position(position_id: str, body: PositionClose):
    """
    Close a position and compute its realized outcome (P&L, %, R-multiple, hold days).
    """
    position = pos_svc.get_position(position_id)
    if not position:
        raise HTTPException(status_code=404, detail=f"Position {position_id} not found")
    if position["status"] == "closed":
        raise HTTPException(status_code=400, detail="Position is already closed")
    if position["status"] == "cancelled":
        raise HTTPException(status_code=400, detail="Position was cancelled and cannot be closed")

    exit_date = body.exit_date or date.today()
    entry_date = date.fromisoformat(str(position["entry_date"]))
    if exit_date < entry_date:
        raise HTTPException(
            status_code=400,
            detail=f"Exit date ({exit_date}) cannot precede the entry date ({entry_date}).",
        )

    return pos_svc.close_position(
        position=position,
        exit_price=body.exit_price,
        exit_date=exit_date,
        exit_reason=body.exit_reason,
        notes=body.notes,
    )


@router.delete("/{position_id}", status_code=204)
def cancel_position(position_id: str):
    """
    Delete a position outright, along with its events (ON DELETE CASCADE).

    For a mistyped entry. A position that was genuinely taken and then exited
    should be closed, not deleted — deleting removes it from every performance
    report, which is exactly the kind of quiet data loss that makes a trade
    journal untrustworthy.
    """
    result = get_client().table("positions").delete().eq("id", position_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail=f"Position {position_id} not found")
    logger.info("Deleted position %s", position_id)
