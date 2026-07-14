/**
 * Metadata for exit-plan stop and target methods.
 *
 * Mirrors the shape of lib/indicators.js so the same tooltip treatment works.
 * Keys must stay in sync with STOP_METHODS / TARGET_METHODS in
 * backend/app/services/exit_strategy.py.
 */

export const STOP_METHODS = {
  atr_multiple: {
    label: "ATR Multiple",
    description: "Places the stop a multiple of Average True Range below entry.",
    interpretation:
      "Scales with volatility — wider in choppy names, tighter in calm ones. 2–3× is the usual swing range.",
  },
  percent: {
    label: "Fixed %",
    description: "Places the stop a fixed percentage below entry.",
    interpretation:
      "Simple and predictable, but ignores how volatile the stock actually is.",
  },
  bb_lower: {
    label: "Lower Bollinger Band",
    description: "Places the stop at the lower Bollinger Band.",
    interpretation:
      "A break below the band suggests the move has failed rather than merely pulled back.",
  },
  ema_21: {
    label: "EMA 21",
    description: "Structure stop at the 21-day exponential moving average.",
    interpretation:
      "Keeps you in the trade while the medium-term trend holds. Tighter than EMA 50.",
  },
  ema_50: {
    label: "EMA 50",
    description: "Structure stop at the 50-day exponential moving average.",
    interpretation:
      "A wide stop that only triggers if the primary trend breaks. Expect fewer shares.",
  },
  swing_low: {
    label: "Swing Low",
    description: "Places the stop at the lowest low of the last 10 bars.",
    interpretation:
      "Respects recent price structure — a break below it means buyers have given up.",
  },
  manual: {
    label: "Manual",
    description: "You choose the stop price directly.",
    interpretation: "Use when you're reading a level off the chart the app can't see.",
  },
}

export const TARGET_METHODS = {
  r_multiple: {
    label: "R Multiple",
    description: "Target set at a multiple of the amount risked.",
    interpretation:
      "A 2R target means the trade makes twice what it risks. Keeps reward tied to risk.",
  },
  atr_multiple: {
    label: "ATR Multiple",
    description: "Target set a multiple of Average True Range above entry.",
    interpretation: "Keeps the target inside the stock's normal range of movement.",
  },
  percent: {
    label: "Fixed %",
    description: "Target set a fixed percentage above entry.",
    interpretation: "Simple, but may be unreachable in a low-volatility name.",
  },
  bb_upper: {
    label: "Upper Bollinger Band",
    description: "Target set at the upper Bollinger Band.",
    interpretation:
      "A natural resistance level, but often gives a thin reward-to-risk ratio.",
  },
  manual: {
    label: "Manual",
    description: "You choose the target price directly.",
    interpretation: "Use when you're reading a resistance level off the chart.",
  },
}

/**
 * Position alert types — trades you actually hold.
 * Distinct from the opportunity alert types in AlertsPage.
 */
export const POSITION_ALERT_META = {
  target_hit: {
    label: "Target Hit",
    variant: "bull",
    description: "Price reached your profit target. Consider taking the trade off.",
  },
  stop_hit: {
    label: "Stop Hit",
    variant: "bear",
    description: "Price hit your stop. The thesis is invalidated — exit.",
  },
  approaching_target: {
    label: "Near Target",
    variant: "secondary",
    description: "Price is within 2% of your target.",
  },
  trailing_stop_moved: {
    label: "Stop Trailed",
    variant: "neutral",
    description: "Your trailing stop ratcheted up to lock in gains.",
  },
  time_stop_reached: {
    label: "Time Stop",
    variant: "outline",
    description: "The trade has run out of time without resolving. Review it.",
  },
}

export const EXIT_REASONS = {
  target_hit:    "Target hit",
  stop_hit:      "Stop hit",
  trailing_stop: "Trailing stop",
  time_stop:     "Time stop",
  manual:        "Closed manually",
  earnings:      "Closed before earnings",
}

export function stopMethodTip(key) {
  const m = STOP_METHODS[key]
  return m ? `${m.description} ${m.interpretation}` : null
}

export function targetMethodTip(key) {
  const m = TARGET_METHODS[key]
  return m ? `${m.description} ${m.interpretation}` : null
}
