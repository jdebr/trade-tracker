import { http, HttpResponse } from "msw"

const API_URL = "http://localhost:8000"

export const handlers = [
  http.get(`${API_URL}/health`, () => {
    return HttpResponse.json({ status: "ok" })
  }),

  http.get(`${API_URL}/screener/results`, () => {
    return HttpResponse.json([
      { symbol: "AAPL", rank: 1, signal_score: 4 },
      { symbol: "MSFT", rank: 2, signal_score: 3 },
    ])
  }),

  http.get(`${API_URL}/watchlist`, () => {
    return HttpResponse.json([])
  }),
]
