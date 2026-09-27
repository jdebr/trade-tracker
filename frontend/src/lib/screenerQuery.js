import { api } from "@/lib/api"

/**
 * The latest screener run, trimmed to tickers that fired at least one active
 * signal (score ≥ 1). No paging: the universe is ~500 names, so the list simply
 * grows or shrinks with how many tickers score. Shared by the Screener and the
 * Watchlist's "Screener" symbol source so both read one cache entry.
 */
export const screenerResultsQuery = {
  queryKey: ["screener-results"],
  queryFn: () => api.get("/screener/results?min_score=1&limit=1000"),
}
