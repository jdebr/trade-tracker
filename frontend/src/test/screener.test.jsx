/**
 * Milestone 6c screener tests.
 *
 * Criteria:
 * 1. "Run Screener" button is present and clickable
 * 2. Clicking run triggers POST /screener/run
 * 3. Results table renders rows from GET /screener/results
 * 4. Score badge renders correct value per row
 * 5. Signal booleans render as coloured indicators
 * 6. Loading skeleton shown while fetch is in flight
 * 7. Error/empty state renders when API returns 404
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "./msw-server"
import { MOCK_SCREENER_RESULTS } from "./handlers"
import ScreenerPage from "../pages/ScreenerPage"

function renderScreener() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ScreenerPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

// 1. Run button is present
it("renders Run Screener button", async () => {
  renderScreener()
  expect(screen.getByRole("button", { name: /run screener/i })).toBeInTheDocument()
})

// 2. Clicking run triggers POST /screener/run
it("clicking Run Screener calls POST /screener/run", async () => {
  const handler = vi.fn()
  server.use(
    http.post("http://localhost:8000/screener/run", () => {
      handler()
      return HttpResponse.json({ run_at: "", pass1_count: 0, pass2_count: 0, candidates: [] })
    })
  )

  renderScreener()
  fireEvent.click(screen.getByRole("button", { name: /run screener/i }))
  await waitFor(() => expect(handler).toHaveBeenCalledOnce())
})

// 3. Results table renders rows
it("renders a row for each result from GET /screener/results", async () => {
  renderScreener()
  // Wait for data
  await waitFor(() =>
    expect(screen.getAllByRole("row")).toHaveLength(MOCK_SCREENER_RESULTS.length + 1) // +1 for header
  )
})

// 4. Score badge renders correct value
it("renders correct score badge for each row", async () => {
  renderScreener()
  await waitFor(() => screen.getAllByRole("row"))

  // Each badge shows "X/4"
  for (const row of MOCK_SCREENER_RESULTS) {
    const badges = screen.getAllByText(`${row.signal_score}/4`)
    expect(badges.length).toBeGreaterThanOrEqual(1) // table + card both render
  }
})

// 5. Signal indicators present (aria-labels from SignalDot)
it("renders signal indicators for the top result", async () => {
  renderScreener()
  await waitFor(() => screen.getAllByRole("row"))

  // AAPL score 4 — all 4 signals true
  expect(screen.getAllByLabelText(/bb squeeze true/i).length).toBeGreaterThan(0)
  expect(screen.getAllByLabelText(/rsi range true/i).length).toBeGreaterThan(0)
  expect(screen.getAllByLabelText(/above ema50 true/i).length).toBeGreaterThan(0)
  expect(screen.getAllByLabelText(/vol expand true/i).length).toBeGreaterThan(0)
})

// 6. Loading skeleton shown before data arrives
it("shows loading skeleton while results are loading", () => {
  // Override handler to never resolve during this render
  server.use(
    http.get("http://localhost:8000/screener/results", () => new Promise(() => {}))
  )
  renderScreener()
  expect(screen.getByLabelText(/loading results/i)).toBeInTheDocument()
})

// 7. Empty/error state when API returns 404
it("shows empty state when GET /screener/results returns 404", async () => {
  server.use(
    http.get("http://localhost:8000/screener/results", () =>
      HttpResponse.json({ detail: "No screener results found" }, { status: 404 })
    )
  )
  renderScreener()
  await waitFor(() =>
    expect(screen.getByRole("alert")).toBeInTheDocument()
  )
})
