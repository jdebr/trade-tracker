import { http, HttpResponse } from "msw"

const API_URL = "http://localhost:8000"

const MOCK_RUN_AT = "2026-03-28T20:00:00Z"

export const MOCK_SCREENER_RESULTS = [
  {
    symbol: "AAPL", rank: 1, signal_score: 4, close_price: 213.49, run_at: MOCK_RUN_AT,
    bb_squeeze: true,  rsi_in_range: true,  above_ema50: true,  volume_expansion: true,
  },
  {
    symbol: "MSFT", rank: 2, signal_score: 3, close_price: 425.00, run_at: MOCK_RUN_AT,
    bb_squeeze: true,  rsi_in_range: true,  above_ema50: true,  volume_expansion: false,
  },
  {
    symbol: "NVDA", rank: 3, signal_score: 2, close_price: 118.20, run_at: MOCK_RUN_AT,
    bb_squeeze: true,  rsi_in_range: true,  above_ema50: false, volume_expansion: false,
  },
  {
    symbol: "JPM",  rank: 4, signal_score: 1, close_price: 240.10, run_at: MOCK_RUN_AT,
    bb_squeeze: false, rsi_in_range: false, above_ema50: true,  volume_expansion: false,
  },
  {
    symbol: "XOM",  rank: 5, signal_score: 0, close_price: 110.55, run_at: MOCK_RUN_AT,
    bb_squeeze: false, rsi_in_range: false, above_ema50: false, volume_expansion: false,
  },
]

export const MOCK_RUN_RESPONSE = {
  run_at: MOCK_RUN_AT,
  pass1_count: 380,
  pass2_count: 5,
  candidates: MOCK_SCREENER_RESULTS,
}

// The four seeded builtins plus one custom signal, as GET /signal-rules returns
// them. Drives dynamic labels/ordering on the Screener.
export const MOCK_SIGNAL_RULES = [
  { id: "sr-1", slug: "bb_squeeze",       name: "BB Squeeze",       description: "Bollinger Band squeeze is active",        type: "bb",     expression: { var: "bb_squeeze" }, weight: 1, enabled: true, is_builtin: true,  sort_order: 1, formatted: "BB Squeeze", created_at: MOCK_RUN_AT, updated_at: MOCK_RUN_AT, deleted_at: null },
  { id: "sr-2", slug: "rsi_in_range",     name: "RSI in range",     description: "RSI(14) between 35 and 65",                 type: "rsi",    expression: { "<=": [35, { var: "rsi_14" }, 65] }, weight: 1, enabled: true, is_builtin: true, sort_order: 2, formatted: "35 <= RSI(14) <= 65", created_at: MOCK_RUN_AT, updated_at: MOCK_RUN_AT, deleted_at: null },
  { id: "sr-3", slug: "above_ema50",      name: "Above EMA 50",     description: "Close is above the 50-day EMA",             type: "ema",    expression: { ">": [{ var: "close" }, { var: "ema_50" }] }, weight: 1, enabled: true, is_builtin: true, sort_order: 3, formatted: "Close > EMA 50", created_at: MOCK_RUN_AT, updated_at: MOCK_RUN_AT, deleted_at: null },
  { id: "sr-4", slug: "volume_expansion", name: "Volume expansion", description: "3-day average volume exceeds 20-day avg",   type: "volume", expression: { ">": [{ var: "vol_3d" }, { var: "vol_20d" }] }, weight: 1, enabled: true, is_builtin: true, sort_order: 4, formatted: "Volume (3d avg) > Volume (20d avg)", created_at: MOCK_RUN_AT, updated_at: MOCK_RUN_AT, deleted_at: null },
  { id: "sr-5", slug: "momentum_pop",     name: "Momentum Pop",     description: "MACD histogram turned positive",            type: "macd",   expression: { ">": [{ var: "macd_hist" }, 0] }, weight: 2, enabled: true, is_builtin: false, sort_order: 5, formatted: "MACD Histogram > 0", created_at: MOCK_RUN_AT, updated_at: MOCK_RUN_AT, deleted_at: null },
]

export const MOCK_ALERTS = [
  {
    id: "alert-1", symbol: "AAPL", date: "2026-03-28",
    alert_type: "bb_squeeze", category: "opportunity", position_id: null, signal_score: 4,
    price_at_trigger: 213.49, acknowledged: false,
    triggered_at: "2026-03-28T20:00:00Z",
    details: { bb_squeeze: true, rsi_in_range: true, above_ema50: true, vol_expansion: true },
  },
  {
    id: "alert-2", symbol: "MSFT", date: "2026-03-28",
    alert_type: "rsi_oversold", category: "opportunity", position_id: null, signal_score: 2,
    price_at_trigger: 388.20, acknowledged: false,
    triggered_at: "2026-03-28T20:01:00Z",
    details: { rsi_14: 28.4, bb_squeeze: false },
  },
  {
    id: "alert-3", symbol: "NVDA", date: "2026-03-27",
    alert_type: "macd_crossover", category: "opportunity", position_id: null, signal_score: null,
    price_at_trigger: 118.75, acknowledged: false,
    triggered_at: "2026-03-27T20:00:00Z",
    details: { macd_hist: 0.32 },
  },
  // A position alert — a trade being held hit its target. Distinct category from
  // the three opportunity alerts above.
  {
    id: "alert-4", symbol: "TSLA", date: "2026-03-28",
    alert_type: "target_hit", category: "position", position_id: "pos-3", signal_score: null,
    price_at_trigger: 230.00, acknowledged: false,
    triggered_at: "2026-03-28T20:02:00Z",
    details: { target_price: 228.0, entry_price: 213.49, is_simulated: true, unrealized_r: 2.1 },
  },
]

// ---------------------------------------------------------------------------
// Positions / settings / reports
// ---------------------------------------------------------------------------

export const MOCK_SETTINGS = {
  account_size: 10000,
  risk_per_trade_pct: 1.0,
  max_position_pct: 25.0,
  default_stop_method: "atr_multiple",
  default_atr_mult: 2.0,
  default_stop_pct: 8.0,
  default_target_method: "r_multiple",
  default_target_r: 2.0,
  default_target_pct: 16.0,
  trail_enabled: false,
  trail_atr_mult: 3.0,
  time_stop_days: 10,
  updated_at: "2026-03-28T20:00:00Z",
}

// entry 100, stop 94 → risk 6/share, 16 shares, 2R target at 112
export const MOCK_EXIT_PLAN = {
  symbol: "AAPL",
  direction: "long",
  entry_price: 100.0,
  stop_method: "atr_multiple",
  stop_price: 94.0,
  target_method: "r_multiple",
  target_price: 112.0,
  risk_per_share: 6.0,
  reward_per_share: 12.0,
  rr_ratio: 2.0,
  shares: 16,
  risk_amount: 96.0,
  position_value: 1600.0,
  position_pct_of_account: 16.0,
  time_stop_date: "2026-04-11",
  trail_enabled: false,
  trail_atr_mult: 3.0,
  stop_candidates: {
    atr_multiple: 94.0, percent: 92.0, bb_lower: 94.5,
    ema_21: 96.0, ema_50: 92.0, swing_low: 90.0, manual: null,
  },
  target_candidates: {
    r_multiple: 112.0, atr_multiple: 112.0, percent: 116.0,
    bb_upper: 108.0, manual: null,
  },
  warnings: [],
  params: { stop_method: "atr_multiple", atr_mult: 2.0, target_r: 2.0 },
}

export const MOCK_POSITIONS = [
  {
    id: "pos-1", symbol: "AAPL", direction: "long",
    is_simulated: true, status: "open",
    alert_id: null, screener_result_id: null,
    entry_date: "2026-03-20", entry_price: 100.0, shares: 16.0, position_value: 1600.0,
    initial_stop_price: 94.0, stop_price: 94.0, target_price: 112.0,
    stop_method: "atr_multiple", target_method: "r_multiple",
    exit_plan: {}, time_stop_date: null,
    risk_per_share: 6.0, risk_amount: 96.0,
    entry_signals: { bb_squeeze: true, signal_score: 3 },
    exit_date: null, exit_price: null, exit_reason: null,
    pnl: null, pnl_pct: null, r_multiple: null, hold_days: null,
    notes: null,
    created_at: "2026-03-20T14:00:00Z", updated_at: "2026-03-20T14:00:00Z",
  },
  {
    id: "pos-2", symbol: "MSFT", direction: "long",
    is_simulated: false, status: "closed",
    alert_id: null, screener_result_id: null,
    entry_date: "2026-03-01", entry_price: 400.0, shares: 5.0, position_value: 2000.0,
    initial_stop_price: 380.0, stop_price: 380.0, target_price: 440.0,
    stop_method: "atr_multiple", target_method: "r_multiple",
    exit_plan: {}, time_stop_date: null,
    risk_per_share: 20.0, risk_amount: 100.0,
    entry_signals: { bb_squeeze: false, signal_score: 2 },
    exit_date: "2026-03-10", exit_price: 440.0, exit_reason: "target_hit",
    pnl: 200.0, pnl_pct: 10.0, r_multiple: 2.0, hold_days: 9,
    notes: null,
    created_at: "2026-03-01T14:00:00Z", updated_at: "2026-03-10T14:00:00Z",
  },
]

export const MOCK_POSITION_QUOTES = { AAPL: 106.0 }

// Latest close per symbol (GET /ohlcv/quotes) — powers the watchlist price column
// and entry/exit prefill.
export const MOCK_QUOTES = { AAPL: 213.49, MSFT: 425.0, JPM: 240.1 }

export const MOCK_PERFORMANCE = {
  filters: { is_simulated: true, date_from: null, date_to: null },
  performance: {
    total_trades: 5, wins: 3, losses: 2, breakeven: 0,
    win_rate: 60.0, total_pnl: 400.0, avg_win: 200.0, avg_loss: 100.0,
    profit_factor: 3.0, expectancy: 80.0,
    total_r: 4.0, avg_r: 0.8,
    largest_win: 300.0, largest_loss: -100.0,
    avg_hold_days: 5.0,
    max_consecutive_wins: 2, max_consecutive_losses: 1,
    max_drawdown_r: 1.0,
    sample_is_thin: true,
  },
  by_exit_reason: [
    { exit_reason: "target_hit", trades: 3, win_rate: 100.0, avg_r: 2.0, total_r: 6.0, total_pnl: 600.0 },
    { exit_reason: "stop_hit",   trades: 2, win_rate: 0.0,   avg_r: -1.0, total_r: -2.0, total_pnl: -200.0 },
  ],
  by_signal_score: [
    { signal_score: 3, trades: 3, win_rate: 66.7, avg_r: 1.2, total_r: 3.6 },
  ],
}

export const MOCK_BY_SIGNAL = {
  total_closed_trades: 5,
  signals: [
    {
      signal: "bb_squeeze",
      with_signal:    { trades: 3, win_rate: 100.0, avg_r: 2.0, total_r: 6.0, expectancy: 200.0 },
      without_signal: { trades: 2, win_rate: 0.0,   avg_r: -1.0, total_r: -2.0, expectancy: -100.0 },
      edge_r: 3.0,
      sample_is_thin: true,
    },
    {
      signal: "volume_expansion",
      with_signal:    { trades: 2, win_rate: 0.0,  avg_r: -1.0, total_r: -2.0, expectancy: -100.0 },
      without_signal: { trades: 3, win_rate: 100.0, avg_r: 2.0, total_r: 6.0, expectancy: 200.0 },
      edge_r: -3.0,
      sample_is_thin: true,
    },
  ],
}

export const MOCK_EQUITY_CURVE = {
  curve: [
    { exit_date: "2026-03-01", symbol: "A", r_multiple: 2.0, pnl: 200, cumulative_r: 2.0, cumulative_pnl: 200 },
    { exit_date: "2026-03-05", symbol: "B", r_multiple: -1.0, pnl: -100, cumulative_r: 1.0, cumulative_pnl: 100 },
    { exit_date: "2026-03-10", symbol: "C", r_multiple: 3.0, pnl: 300, cumulative_r: 4.0, cumulative_pnl: 400 },
  ],
}

// Generate 30 synthetic OHLCV bars ending today
function makeBars(n = 30) {
  const bars = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    const close = 200 + Math.sin(i / 5) * 10
    bars.push({ symbol: "AAPL", date: dateStr, open: close - 1, high: close + 2, low: close - 2, close, volume: 1_000_000, source: "yfinance" })
  }
  return bars
}

export const MOCK_BARS = makeBars(30)

export const MOCK_INDICATOR_HISTORY = MOCK_BARS.map((b) => ({
  symbol: "AAPL", date: b.date,
  bb_upper: b.close + 5, bb_middle: b.close, bb_lower: b.close - 5,
  ema_8: b.close + 1, ema_21: b.close + 0.5, ema_50: b.close - 1,
}))

export const MOCK_SNAPSHOTS = [
  {
    symbol: "AAPL", date: "2026-03-28",
    rsi_14: 52.3, bb_squeeze: true,  macd_hist: 0.45, ema_50: 205.0, atr_14: 3.2,
  },
  {
    symbol: "MSFT", date: "2026-03-28",
    rsi_14: 72.1, bb_squeeze: false, macd_hist: -0.2, ema_50: 410.0, atr_14: 5.8,
  },
  {
    symbol: "JPM",  date: "2026-03-28",
    rsi_14: 28.4, bb_squeeze: false, macd_hist: 0.01, ema_50: 235.0, atr_14: 2.9,
  },
]

export const MOCK_WATCHLIST = [
  { id: "1", symbol: "AAPL", group_name: "Tech",  added_at: "2026-03-01T00:00:00Z" },
  { id: "2", symbol: "MSFT", group_name: "Tech",  added_at: "2026-03-02T00:00:00Z" },
  { id: "3", symbol: "JPM",  group_name: "Banks", added_at: "2026-03-03T00:00:00Z" },
]

export const MOCK_SCHEDULER_STATUS = {
  enabled: true,
  paused: false,
  pause_until: null,
  next_run_time: "2026-03-29T20:00:00Z",
  last_run_at: "2026-03-28T20:00:00Z",
  last_run_result: null,
  cooldown_minutes: 60,
  seconds_until_cooldown_expires: null,
  schedule: "16:00 ET Mon–Fri",
}

export const MOCK_JOB_ID = "test-job-123"

export const MOCK_JOB_DONE = {
  job_id: MOCK_JOB_ID,
  status: "done",
  created_at: "2026-03-29T20:00:00Z",
  started_at: "2026-03-29T20:00:01Z",
  finished_at: "2026-03-29T20:01:00Z",
  result: {
    run_at: MOCK_RUN_RESPONSE.run_at,
    pass1_count: MOCK_RUN_RESPONSE.pass1_count,
    pass2_count: MOCK_RUN_RESPONSE.pass2_count,
    candidates: MOCK_RUN_RESPONSE.candidates,
  },
  error: null,
}

export const MOCK_REFRESH_JOB_DONE = {
  job_id: MOCK_JOB_ID,
  status: "done",
  created_at: "2026-03-29T20:00:00Z",
  started_at: "2026-03-29T20:00:01Z",
  finished_at: "2026-03-29T20:05:00Z",
  result: {
    attempted: 508,
    fetched: 500,
    skipped_fresh: 0,
    failed: 8,
    elapsed_seconds: 240,
  },
  error: null,
}

export const handlers = [
  http.get(`${API_URL}/health`, () =>
    HttpResponse.json({ status: "ok" })
  ),

  http.get(`${API_URL}/screener/results`, () =>
    HttpResponse.json(MOCK_SCREENER_RESULTS)
  ),

  http.get(`${API_URL}/signal-rules`, () =>
    HttpResponse.json(MOCK_SIGNAL_RULES)
  ),

  http.post(`${API_URL}/signal-rules`, async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json(
      {
        id: "sr-new", slug: "new_signal", name: body.name, description: body.description ?? null,
        type: body.type ?? null, expression: body.expression, weight: body.weight ?? 1,
        enabled: true, is_builtin: false, sort_order: 99, formatted: "RSI(14) < 30",
        created_at: MOCK_RUN_AT, updated_at: MOCK_RUN_AT, deleted_at: null,
      },
      { status: 201 }
    )
  }),

  http.patch(`${API_URL}/signal-rules/:id`, async ({ params, request }) => {
    const body = await request.json()
    const base = MOCK_SIGNAL_RULES.find((r) => r.id === params.id) || MOCK_SIGNAL_RULES[0]
    return HttpResponse.json({ ...base, ...body })
  }),

  http.delete(`${API_URL}/signal-rules/:id`, ({ params }) => {
    const base = MOCK_SIGNAL_RULES.find((r) => r.id === params.id) || MOCK_SIGNAL_RULES[0]
    return HttpResponse.json({ ...base, enabled: false, deleted_at: "2026-03-29T00:00:00Z" })
  }),

  http.post(`${API_URL}/signal-rules/:id/restore`, ({ params }) => {
    const base = MOCK_SIGNAL_RULES.find((r) => r.id === params.id) || MOCK_SIGNAL_RULES[0]
    return HttpResponse.json({ ...base, enabled: true, deleted_at: null })
  }),

  // ---- Rule engine (validate / preview / preview-universe) ----------------

  http.post(`${API_URL}/rules/validate`, async ({ request }) => {
    const { rule } = await request.json()
    const valid = !JSON.stringify(rule).includes("nope")
    return HttpResponse.json({
      valid,
      errors: valid ? [] : ["unknown variable: nope"],
      variables_used: valid ? ["rsi_14"] : ["nope"],
      formatted: "RSI(14) < 30",
    })
  }),

  http.post(`${API_URL}/rules/preview`, async ({ request }) => {
    const { symbol } = await request.json()
    return HttpResponse.json({
      symbol: (symbol || "").toUpperCase(),
      value: true,
      variables_used: ["rsi_14"],
      features_used: { rsi_14: 27.4 },
      formatted: "RSI(14) < 30",
      errors: [],
    })
  }),

  http.post(`${API_URL}/rules/preview-universe`, async () =>
    HttpResponse.json({
      universe_count: 380, evaluated_count: 372, match_count: 2,
      matched: ["AMD", "NVDA"],
      values: { AMD: { rsi_14: 27.4 }, NVDA: { rsi_14: 22.1 } },
      variables_used: ["rsi_14"], formatted: "RSI(14) < 30", errors: [],
    })
  ),

  // Screener run: POST returns job_id, GET /job/:id returns done immediately
  http.post(`${API_URL}/screener/run`, () =>
    HttpResponse.json({ job_id: MOCK_JOB_ID, status: "pending" }, { status: 202 })
  ),

  // Data refresh: POST returns job_id, GET /job/:id returns done immediately
  http.post(`${API_URL}/screener/refresh-data`, () =>
    HttpResponse.json({ job_id: MOCK_JOB_ID, status: "pending" }, { status: 202 })
  ),

  http.get(`${API_URL}/screener/job/:jobId`, () =>
    HttpResponse.json(MOCK_JOB_DONE)
  ),

  http.get(`${API_URL}/scheduler/status`, () =>
    HttpResponse.json(MOCK_SCHEDULER_STATUS)
  ),

  http.post(`${API_URL}/scheduler/trigger`, () =>
    HttpResponse.json({ message: "Scan completed", result: null })
  ),

  http.get(`${API_URL}/watchlist`, () =>
    HttpResponse.json(MOCK_WATCHLIST)
  ),

  http.get(`${API_URL}/indicators/snapshots`, () =>
    HttpResponse.json(MOCK_SNAPSHOTS)
  ),

  http.get(`${API_URL}/ohlcv/quotes`, ({ request }) => {
    const symbols = (new URL(request.url).searchParams.get("symbols") || "").split(",").filter(Boolean)
    const out = {}
    for (const s of symbols) if (MOCK_QUOTES[s] != null) out[s] = MOCK_QUOTES[s]
    return HttpResponse.json(out)
  }),

  http.get(`${API_URL}/alerts`, () =>
    HttpResponse.json(MOCK_ALERTS)
  ),

  http.patch(`${API_URL}/alerts/:id/acknowledge`, ({ params }) =>
    HttpResponse.json({ id: params.id, acknowledged: true })
  ),

  http.post(`${API_URL}/alerts/acknowledge-all`, () =>
    HttpResponse.json({ acknowledged_count: MOCK_ALERTS.length })
  ),

  http.get(`${API_URL}/ohlcv/bars`, () =>
    HttpResponse.json(MOCK_BARS)
  ),

  http.get(`${API_URL}/indicators/history`, () =>
    HttpResponse.json(MOCK_INDICATOR_HISTORY)
  ),

  http.get(`${API_URL}/tickers`, () =>
    HttpResponse.json([
      { symbol: "AAPL", name: "Apple Inc." },
      { symbol: "MSFT", name: "Microsoft Corporation" },
      { symbol: "NVDA", name: "NVIDIA Corporation" },
      { symbol: "JPM",  name: "JPMorgan Chase & Co." },
      { symbol: "XOM",  name: "Exxon Mobil Corporation" },
    ])
  ),

  http.post(`${API_URL}/indicators/compute`, () =>
    HttpResponse.json({ job_id: MOCK_JOB_ID, status: "pending" }, { status: 202 })
  ),

  http.post(`${API_URL}/watchlist`, async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json(
      { id: "99", symbol: body.symbol.toUpperCase(), group_name: body.group_name ?? null, added_at: new Date().toISOString() },
      { status: 201 }
    )
  }),

  http.delete(`${API_URL}/watchlist/:symbol`, () =>
    new HttpResponse(null, { status: 204 })
  ),

  // ---- Positions ----------------------------------------------------------

  http.get(`${API_URL}/positions/quotes`, () =>
    HttpResponse.json(MOCK_POSITION_QUOTES)
  ),

  http.get(`${API_URL}/positions`, ({ request }) => {
    const status = new URL(request.url).searchParams.get("status")
    const rows = status ? MOCK_POSITIONS.filter((p) => p.status === status) : MOCK_POSITIONS
    return HttpResponse.json(rows)
  }),

  http.post(`${API_URL}/positions/plan`, () =>
    HttpResponse.json(MOCK_EXIT_PLAN)
  ),

  http.post(`${API_URL}/positions`, () =>
    HttpResponse.json(MOCK_POSITIONS[0], { status: 201 })
  ),

  http.post(`${API_URL}/positions/:id/close`, () =>
    HttpResponse.json({ ...MOCK_POSITIONS[0], status: "closed" })
  ),

  // ---- Settings -----------------------------------------------------------

  http.get(`${API_URL}/settings`, () =>
    HttpResponse.json(MOCK_SETTINGS)
  ),

  http.patch(`${API_URL}/settings`, async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ ...MOCK_SETTINGS, ...body })
  }),

  // ---- Reports ------------------------------------------------------------

  http.get(`${API_URL}/reports/performance`, () =>
    HttpResponse.json(MOCK_PERFORMANCE)
  ),

  http.get(`${API_URL}/reports/by-signal`, () =>
    HttpResponse.json(MOCK_BY_SIGNAL)
  ),

  http.get(`${API_URL}/reports/equity-curve`, () =>
    HttpResponse.json(MOCK_EQUITY_CURVE)
  ),
]
