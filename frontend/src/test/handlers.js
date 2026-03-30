import { http, HttpResponse } from "msw"

const API_URL = "http://localhost:8000"

export const MOCK_SCREENER_RESULTS = [
  {
    symbol: "AAPL", rank: 1, signal_score: 4, close_price: 213.49,
    bb_squeeze: true,  rsi_in_range: true,  above_ema50: true,  volume_expansion: true,
  },
  {
    symbol: "MSFT", rank: 2, signal_score: 3, close_price: 425.00,
    bb_squeeze: true,  rsi_in_range: true,  above_ema50: true,  volume_expansion: false,
  },
  {
    symbol: "NVDA", rank: 3, signal_score: 2, close_price: 118.20,
    bb_squeeze: true,  rsi_in_range: true,  above_ema50: false, volume_expansion: false,
  },
  {
    symbol: "JPM",  rank: 4, signal_score: 1, close_price: 240.10,
    bb_squeeze: false, rsi_in_range: false, above_ema50: true,  volume_expansion: false,
  },
  {
    symbol: "XOM",  rank: 5, signal_score: 0, close_price: 110.55,
    bb_squeeze: false, rsi_in_range: false, above_ema50: false, volume_expansion: false,
  },
]

export const MOCK_RUN_RESPONSE = {
  run_at: "2026-03-28T20:00:00Z",
  pass1_count: 380,
  pass2_count: 5,
  candidates: MOCK_SCREENER_RESULTS,
}

export const MOCK_ALERTS = [
  {
    id: "alert-1", symbol: "AAPL", date: "2026-03-28",
    alert_type: "bb_squeeze", signal_score: 4,
    price_at_trigger: 213.49, acknowledged: false,
    triggered_at: "2026-03-28T20:00:00Z",
    details: { bb_squeeze: true, rsi_in_range: true, above_ema50: true, vol_expansion: true },
  },
  {
    id: "alert-2", symbol: "MSFT", date: "2026-03-28",
    alert_type: "rsi_oversold", signal_score: 2,
    price_at_trigger: 388.20, acknowledged: false,
    triggered_at: "2026-03-28T20:01:00Z",
    details: { rsi_14: 28.4, bb_squeeze: false },
  },
  {
    id: "alert-3", symbol: "NVDA", date: "2026-03-27",
    alert_type: "macd_crossover", signal_score: null,
    price_at_trigger: 118.75, acknowledged: false,
    triggered_at: "2026-03-27T20:00:00Z",
    details: { macd_hist: 0.32 },
  },
]

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

export const handlers = [
  http.get(`${API_URL}/health`, () =>
    HttpResponse.json({ status: "ok" })
  ),

  http.get(`${API_URL}/screener/results`, () =>
    HttpResponse.json(MOCK_SCREENER_RESULTS)
  ),

  // Background job: POST returns job_id, GET /job/:id returns done immediately
  http.post(`${API_URL}/screener/run`, () =>
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
]
