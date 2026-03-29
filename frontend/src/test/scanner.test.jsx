/**
 * Milestone 6e scanner tests.
 *
 * Criteria:
 * 1. Snapshot rows render for each watchlist symbol
 * 2. RSI is colour-coded: green 35-65, red ≥70, blue ≤30
 * 3. BB Squeeze renders as a filled dot when true, empty when false
 * 4. MACD hist is green when positive, red when negative
 * 5. Loading skeleton shown while fetching
 * 6. Empty state when watchlist is empty
 * 7. No-snapshot state when watchlist has symbols but no snapshots returned
 */

import { it, expect } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "./msw-server"
import { MOCK_SNAPSHOTS } from "./handlers"
import ScannerPage from "../pages/ScannerPage"

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ScannerPage /></MemoryRouter>
    </QueryClientProvider>
  )
}

// 1. Rows render for each watchlist symbol
it("renders a row for each snapshot", async () => {
  renderPage()
  for (const snap of MOCK_SNAPSHOTS) {
    await waitFor(() => expect(screen.getAllByText(snap.symbol)[0]).toBeInTheDocument())
  }
})

// 2. RSI colour-coding via class
it("RSI in-range (35-65) gets green colour class", async () => {
  renderPage()
  // AAPL rsi=52.3 → green
  await waitFor(() => screen.getAllByText("AAPL")[0])
  const rsiCells = screen.getAllByText("52.3")
  expect(rsiCells[0].className).toMatch(/green/)
})

it("RSI overbought (≥70) gets red colour class", async () => {
  renderPage()
  await waitFor(() => screen.getAllByText("MSFT")[0])
  const rsiCells = screen.getAllByText("72.1")
  expect(rsiCells[0].className).toMatch(/red/)
})

it("RSI oversold (≤30) gets blue colour class", async () => {
  renderPage()
  await waitFor(() => screen.getAllByText("JPM")[0])
  const rsiCells = screen.getAllByText("28.4")
  expect(rsiCells[0].className).toMatch(/blue/)
})

// 3. BB Squeeze dot: AAPL=true → aria-label "true", MSFT=false → "false"
it("BB Squeeze dot reflects true/false state", async () => {
  renderPage()
  await waitFor(() => screen.getAllByText("AAPL")[0])
  const trueDots  = screen.getAllByLabelText("true")
  const falseDots = screen.getAllByLabelText("false")
  expect(trueDots.length).toBeGreaterThan(0)
  expect(falseDots.length).toBeGreaterThan(0)
})

// 4. MACD hist colour: positive=green, negative=red
it("positive MACD hist gets green colour class", async () => {
  renderPage()
  await waitFor(() => screen.getAllByText("AAPL")[0])
  const macdCells = screen.getAllByText("0.45")
  expect(macdCells[0].className).toMatch(/green/)
})

it("negative MACD hist gets red colour class", async () => {
  renderPage()
  await waitFor(() => screen.getAllByText("MSFT")[0])
  const macdCells = screen.getAllByText("-0.20")
  expect(macdCells[0].className).toMatch(/red/)
})

// 5. Loading skeleton
it("shows loading skeleton while fetching", () => {
  server.use(
    http.get("http://localhost:8000/watchlist", () => new Promise(() => {}))
  )
  renderPage()
  expect(screen.getByLabelText(/loading scanner/i)).toBeInTheDocument()
})

// 6. Empty state when watchlist is empty
it("shows empty state when watchlist is empty", async () => {
  server.use(
    http.get("http://localhost:8000/watchlist", () => HttpResponse.json([]))
  )
  renderPage()
  await waitFor(() =>
    expect(screen.getByText(/add tickers to your watchlist/i)).toBeInTheDocument()
  )
})

// 7. No-snapshot state
it("shows no-snapshot message when watchlist has symbols but no snapshots", async () => {
  server.use(
    http.get("http://localhost:8000/indicators/snapshots", () => HttpResponse.json([]))
  )
  renderPage()
  await waitFor(() =>
    expect(screen.getByText(/no indicator snapshots found/i)).toBeInTheDocument()
  )
})
