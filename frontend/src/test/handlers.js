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
    HttpResponse.json([])
  ),
]
