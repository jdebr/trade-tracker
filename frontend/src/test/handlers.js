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

export const MOCK_WATCHLIST = [
  { id: "1", symbol: "AAPL", group_name: "Tech",  added_at: "2026-03-01T00:00:00Z" },
  { id: "2", symbol: "MSFT", group_name: "Tech",  added_at: "2026-03-02T00:00:00Z" },
  { id: "3", symbol: "JPM",  group_name: "Banks", added_at: "2026-03-03T00:00:00Z" },
]

export const handlers = [
  http.get(`${API_URL}/health`, () =>
    HttpResponse.json({ status: "ok" })
  ),

  http.get(`${API_URL}/screener/results`, () =>
    HttpResponse.json(MOCK_SCREENER_RESULTS)
  ),

  http.post(`${API_URL}/screener/run`, () =>
    HttpResponse.json(MOCK_RUN_RESPONSE)
  ),

  http.get(`${API_URL}/watchlist`, () =>
    HttpResponse.json(MOCK_WATCHLIST)
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
