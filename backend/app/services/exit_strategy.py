"""
Exit strategy builder — computes stop levels, profit targets, and position size
for a prospective trade.

Everything here is a pure function of (entry price, indicator snapshot, recent
bars, parameters). Nothing touches the database except `load_market_context()`,
which is the one impure seam and is kept deliberately thin so the maths can be
unit-tested against hand-built fixtures.

The vocabulary follows standard swing-trading practice rather than anything
invented here:

  R          The dollar amount risked on the trade: (entry - stop) * shares.
             Every outcome is normalized to R so trades of different sizes can
             be averaged together. A 2R win means "made twice what I risked".
  ATR stop   Stop placed a multiple of Average True Range below entry, so the
             stop widens in volatile names and tightens in calm ones. 2-3x on a
             daily chart is the conventional swing range; we default to 2x.
  Sizing     Share count is derived from a fixed fractional risk budget:
             risk 1% of the account per trade, whatever the stop distance.
             This is what makes R comparable across trades.

Public API:
    build_exit_plan(...)      -> ExitPlan
    load_market_context(symbol) -> MarketContext
    compute_trailing_stop(...)  -> float | None
    ExitPlanError
"""

import logging
import math
from dataclasses import dataclass, field
from datetime import date, timedelta

from app.services.indicator_cache import get_latest_snapshots
from app.services.ohlcv_cache import get_cached_bars

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Methods
# ---------------------------------------------------------------------------

STOP_METHODS = (
    "atr_multiple",   # entry - (atr * mult)      — volatility-scaled (default)
    "percent",        # entry * (1 - pct/100)     — fixed percentage
    "bb_lower",       # lower Bollinger band      — volatility envelope
    "ema_21",         # structure stop at EMA-21
    "ema_50",         # structure stop at EMA-50
    "swing_low",      # lowest low of the last N bars
    "manual",         # user-supplied price
)

TARGET_METHODS = (
    "r_multiple",     # entry + (risk_per_share * R)  — default
    "atr_multiple",   # entry + (atr * mult)
    "percent",        # entry * (1 + pct/100)
    "bb_upper",       # upper Bollinger band
    "manual",         # user-supplied price
)

# How many trailing bars `swing_low` / `swing_high` look back over.
SWING_LOOKBACK = 10

# Thresholds that produce advisory warnings (not errors).
MIN_RR_RATIO       = 1.5    # below this, the trade risks more than it stands to make
MAX_STOP_DISTANCE  = 15.0   # a stop more than 15% away is a very wide swing stop
APPROACHING_TARGET = 2.0    # within 2% of target — used by the position monitor


class ExitPlanError(ValueError):
    """Raised when a plan cannot be built (e.g. the stop is on the wrong side of entry)."""


# ---------------------------------------------------------------------------
# Market context — the one DB-touching function in this module
# ---------------------------------------------------------------------------

@dataclass
class MarketContext:
    """Everything the calculator needs to know about a symbol's current state."""
    symbol:   str
    snapshot: dict | None = None          # latest indicator_snapshots row
    bars:     list[dict] = field(default_factory=list)  # recent OHLCV, oldest → newest

    @property
    def last_close(self) -> float | None:
        return float(self.bars[-1]["close"]) if self.bars else None

    def swing_low(self, lookback: int = SWING_LOOKBACK) -> float | None:
        window = self.bars[-lookback:]
        return min(float(b["low"]) for b in window) if window else None

    def swing_high(self, lookback: int = SWING_LOOKBACK) -> float | None:
        window = self.bars[-lookback:]
        return max(float(b["high"]) for b in window) if window else None

    def indicator(self, key: str) -> float | None:
        """Return a numeric indicator from the snapshot, or None if absent/null."""
        if not self.snapshot:
            return None
        value = self.snapshot.get(key)
        return float(value) if value is not None else None


def load_market_context(symbol: str) -> MarketContext:
    """Load the latest indicator snapshot and recent bars for a symbol."""
    symbol = symbol.upper()
    snapshots = get_latest_snapshots([symbol])
    bars = get_cached_bars(symbol, limit=60)
    return MarketContext(
        symbol=symbol,
        snapshot=snapshots[0] if snapshots else None,
        bars=bars,
    )


# ---------------------------------------------------------------------------
# Candidate levels
# ---------------------------------------------------------------------------

def compute_stop_candidates(
    entry_price: float,
    ctx:         MarketContext,
    atr_mult:    float = 2.0,
    stop_pct:    float = 8.0,
    manual_stop: float | None = None,
) -> dict[str, float | None]:
    """
    Compute every stop level side by side so the caller can compare them.

    Methods whose inputs are unavailable (e.g. no ATR in the snapshot) return
    None rather than raising — the UI shows them greyed out.
    """
    atr = ctx.indicator("atr_14")

    return {
        "atr_multiple": entry_price - (atr * atr_mult) if atr else None,
        "percent":      entry_price * (1 - stop_pct / 100),
        "bb_lower":     ctx.indicator("bb_lower"),
        "ema_21":       ctx.indicator("ema_21"),
        "ema_50":       ctx.indicator("ema_50"),
        "swing_low":    ctx.swing_low(),
        "manual":       manual_stop,
    }


def compute_target_candidates(
    entry_price:    float,
    risk_per_share: float,
    ctx:            MarketContext,
    target_r:       float = 2.0,
    target_pct:     float = 16.0,
    atr_mult:       float = 4.0,
    manual_target:  float | None = None,
) -> dict[str, float | None]:
    """
    Compute every target level side by side.

    `r_multiple` depends on risk_per_share, so the stop must be chosen first —
    this is why targets are computed in a second pass rather than alongside stops.
    """
    atr = ctx.indicator("atr_14")

    return {
        "r_multiple":   entry_price + (risk_per_share * target_r),
        "atr_multiple": entry_price + (atr * atr_mult) if atr else None,
        "percent":      entry_price * (1 + target_pct / 100),
        "bb_upper":     ctx.indicator("bb_upper"),
        "manual":       manual_target,
    }


# ---------------------------------------------------------------------------
# Position sizing
# ---------------------------------------------------------------------------

def size_position(
    entry_price:    float,
    risk_per_share: float,
    account_size:   float,
    risk_pct:       float,
) -> tuple[int, float, float]:
    """
    Fixed-fractional position sizing.

    Risk a constant fraction of the account on every trade, and let the stop
    distance determine the share count. A tight stop buys more shares, a wide
    stop fewer — but the dollars at risk are the same either way, which is what
    makes R-multiples comparable across trades.

    Returns (shares, risk_amount, position_value).
    Shares are floored — never round up into more risk than budgeted.
    """
    risk_budget = account_size * (risk_pct / 100)
    shares      = math.floor(risk_budget / risk_per_share)
    return shares, shares * risk_per_share, shares * entry_price


# ---------------------------------------------------------------------------
# Plan
# ---------------------------------------------------------------------------

@dataclass
class ExitPlan:
    symbol:      str
    direction:   str
    entry_price: float

    stop_method:   str
    stop_price:    float
    target_method: str
    target_price:  float | None

    risk_per_share:   float
    reward_per_share: float | None
    rr_ratio:         float | None

    shares:                  int
    risk_amount:             float
    position_value:          float
    position_pct_of_account: float

    time_stop_date: str | None
    trail_enabled:  bool
    trail_atr_mult: float

    # Every alternative level, for the comparison table in the builder UI.
    stop_candidates:   dict[str, float | None]
    target_candidates: dict[str, float | None]

    warnings: list[str]
    params:   dict          # the full parameter set — persisted to positions.exit_plan

    def to_dict(self) -> dict:
        return {
            "symbol":                  self.symbol,
            "direction":               self.direction,
            "entry_price":             round(self.entry_price, 4),
            "stop_method":             self.stop_method,
            "stop_price":              round(self.stop_price, 4),
            "target_method":           self.target_method,
            "target_price":            round(self.target_price, 4) if self.target_price else None,
            "risk_per_share":          round(self.risk_per_share, 4),
            "reward_per_share":        round(self.reward_per_share, 4) if self.reward_per_share else None,
            "rr_ratio":                round(self.rr_ratio, 2) if self.rr_ratio else None,
            "shares":                  self.shares,
            "risk_amount":             round(self.risk_amount, 2),
            "position_value":          round(self.position_value, 2),
            "position_pct_of_account": round(self.position_pct_of_account, 2),
            "time_stop_date":          self.time_stop_date,
            "trail_enabled":           self.trail_enabled,
            "trail_atr_mult":          self.trail_atr_mult,
            "stop_candidates":         {
                k: (round(v, 4) if v is not None else None)
                for k, v in self.stop_candidates.items()
            },
            "target_candidates":       {
                k: (round(v, 4) if v is not None else None)
                for k, v in self.target_candidates.items()
            },
            "warnings":                self.warnings,
            "params":                  self.params,
        }


def build_exit_plan(
    symbol:        str,
    entry_price:   float,
    ctx:           MarketContext,
    settings:      dict,
    stop_method:   str | None = None,
    target_method: str | None = None,
    atr_mult:      float | None = None,
    stop_pct:      float | None = None,
    target_r:      float | None = None,
    target_pct:    float | None = None,
    manual_stop:   float | None = None,
    manual_target: float | None = None,
    account_size:  float | None = None,
    risk_pct:      float | None = None,
    direction:     str = "long",
    entry_date:    date | None = None,
) -> ExitPlan:
    """
    Build a complete exit plan: stop, target, share count, risk, and warnings.

    Every parameter falls back to the corresponding value in `settings`, so the
    caller can pass only what the user overrode.

    Raises ExitPlanError when the plan is structurally invalid — a stop on the
    wrong side of entry, or a stop method whose inputs aren't available.
    """
    if direction != "long":
        raise ExitPlanError("Only long positions are supported in v1")

    # Resolve parameters: explicit override → settings default.
    stop_method   = stop_method   or settings["default_stop_method"]
    target_method = target_method or settings["default_target_method"]
    atr_mult      = _coalesce(atr_mult,     settings["default_atr_mult"])
    stop_pct      = _coalesce(stop_pct,     settings["default_stop_pct"])
    target_r      = _coalesce(target_r,     settings["default_target_r"])
    target_pct    = _coalesce(target_pct,   settings["default_target_pct"])
    account_size  = _coalesce(account_size, settings["account_size"])
    risk_pct      = _coalesce(risk_pct,     settings["risk_per_trade_pct"])

    if stop_method not in STOP_METHODS:
        raise ExitPlanError(f"Unknown stop method: {stop_method}")
    if target_method not in TARGET_METHODS:
        raise ExitPlanError(f"Unknown target method: {target_method}")

    # --- Stop ---------------------------------------------------------------
    stop_candidates = compute_stop_candidates(
        entry_price, ctx, atr_mult=atr_mult, stop_pct=stop_pct, manual_stop=manual_stop,
    )
    stop_price = stop_candidates[stop_method]
    if stop_price is None:
        raise ExitPlanError(
            f"Cannot compute a '{stop_method}' stop for {symbol} — "
            f"the required indicator data is missing. Run a scan first, or pick another method."
        )

    # A long's stop must sit below entry, or there is no risk to divide by and
    # every downstream number (R, share count, R:R) is meaningless.
    risk_per_share = entry_price - stop_price
    if risk_per_share <= 0:
        raise ExitPlanError(
            f"Stop ({stop_price:.2f}) must be below the entry price ({entry_price:.2f}) "
            f"for a long position."
        )

    # --- Target -------------------------------------------------------------
    target_candidates = compute_target_candidates(
        entry_price, risk_per_share, ctx,
        target_r=target_r, target_pct=target_pct,
        atr_mult=atr_mult * 2,   # a target ATR band is conventionally ~2x the stop band
        manual_target=manual_target,
    )
    target_price = target_candidates[target_method]

    reward_per_share = (target_price - entry_price) if target_price else None
    rr_ratio = (reward_per_share / risk_per_share) if reward_per_share else None

    # --- Size ---------------------------------------------------------------
    shares, risk_amount, position_value = size_position(
        entry_price, risk_per_share, account_size, risk_pct,
    )
    position_pct = (position_value / account_size * 100) if account_size else 0.0

    # --- Time stop ----------------------------------------------------------
    time_stop_days = int(settings["time_stop_days"])
    base_date      = entry_date or date.today()
    time_stop_date = (
        _add_trading_days(base_date, time_stop_days).isoformat()
        if time_stop_days > 0 else None
    )

    # --- Warnings -----------------------------------------------------------
    warnings: list[str] = []

    if shares == 0:
        warnings.append(
            f"Risk budget (${account_size * risk_pct / 100:,.0f}) is too small for a "
            f"${risk_per_share:.2f}/share stop — this trade would be 0 shares. "
            f"Tighten the stop or raise the risk percentage."
        )

    if rr_ratio is not None and rr_ratio < MIN_RR_RATIO:
        warnings.append(
            f"Reward-to-risk is {rr_ratio:.2f}:1, below the {MIN_RR_RATIO}:1 minimum. "
            f"You are risking more than this trade stands to make."
        )

    if target_price is not None and target_price <= entry_price:
        warnings.append(
            f"Target ({target_price:.2f}) is at or below entry ({entry_price:.2f}) — "
            f"this plan cannot make money."
        )

    stop_distance_pct = risk_per_share / entry_price * 100
    if stop_distance_pct > MAX_STOP_DISTANCE:
        warnings.append(
            f"Stop is {stop_distance_pct:.1f}% below entry — unusually wide for a swing trade. "
            f"Position size has been reduced to compensate."
        )

    max_position_pct = float(settings["max_position_pct"])
    if position_pct > max_position_pct:
        warnings.append(
            f"Position is {position_pct:.1f}% of the account, above the "
            f"{max_position_pct:.0f}% concentration limit."
        )

    params = {
        "stop_method":    stop_method,
        "target_method":  target_method,
        "atr_mult":       atr_mult,
        "stop_pct":       stop_pct,
        "target_r":       target_r,
        "target_pct":     target_pct,
        "account_size":   account_size,
        "risk_pct":       risk_pct,
        "trail_enabled":  bool(settings["trail_enabled"]),
        "trail_atr_mult": float(settings["trail_atr_mult"]),
        "time_stop_days": time_stop_days,
        "atr_14_at_entry": ctx.indicator("atr_14"),
    }

    return ExitPlan(
        symbol=symbol.upper(),
        direction=direction,
        entry_price=entry_price,
        stop_method=stop_method,
        stop_price=stop_price,
        target_method=target_method,
        target_price=target_price,
        risk_per_share=risk_per_share,
        reward_per_share=reward_per_share,
        rr_ratio=rr_ratio,
        shares=shares,
        risk_amount=risk_amount,
        position_value=position_value,
        position_pct_of_account=position_pct,
        time_stop_date=time_stop_date,
        trail_enabled=bool(settings["trail_enabled"]),
        trail_atr_mult=float(settings["trail_atr_mult"]),
        stop_candidates=stop_candidates,
        target_candidates=target_candidates,
        warnings=warnings,
        params=params,
    )


# ---------------------------------------------------------------------------
# Trailing stop (chandelier exit)
# ---------------------------------------------------------------------------

def compute_trailing_stop(
    current_stop:   float,
    highest_high:   float,
    atr:            float,
    trail_atr_mult: float = 3.0,
) -> float | None:
    """
    Chandelier exit: hang the stop a multiple of ATR below the highest high made
    since entry, so it follows the trade up and locks in gains.

    Returns the new stop, or None if it would not move.

    The stop RATCHETS: it only ever moves up, never down. A trailing stop that
    could loosen would let a winning trade give back more than the original risk,
    which defeats the entire purpose.
    """
    candidate = highest_high - (atr * trail_atr_mult)
    return candidate if candidate > current_stop else None


# ---------------------------------------------------------------------------
# Outcome maths — used on close and by the reports
# ---------------------------------------------------------------------------

def compute_outcome(
    entry_price:        float,
    exit_price:         float,
    shares:             float,
    initial_stop_price: float,
) -> dict:
    """
    Compute the realized outcome of a closed position.

    R-multiple is measured against the INITIAL stop, not the trailed one. The
    initial stop is what was actually risked when the trade was put on; measuring
    against a trailed stop would flatter every winner.
    """
    risk_per_share = entry_price - initial_stop_price
    pnl            = (exit_price - entry_price) * shares
    pnl_pct        = (exit_price - entry_price) / entry_price * 100
    r_multiple     = (exit_price - entry_price) / risk_per_share if risk_per_share > 0 else None

    return {
        "pnl":        round(pnl, 4),
        "pnl_pct":    round(pnl_pct, 4),
        "r_multiple": round(r_multiple, 4) if r_multiple is not None else None,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _coalesce(override, default):
    """Return the override if it was supplied, else the settings default (as float)."""
    return float(override if override is not None else default)


def _add_trading_days(start: date, n: int) -> date:
    """
    Add n weekdays to a date. Ignores market holidays — the time stop is a soft
    nudge to review a stalled trade, not a precise deadline, so approximating
    holidays away is fine and avoids a market-calendar dependency here.
    """
    current = start
    remaining = n
    while remaining > 0:
        current += timedelta(days=1)
        if current.weekday() < 5:
            remaining -= 1
    return current
