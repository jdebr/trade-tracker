/**
 * Chart page tests — Milestones 6f + 8.
 *
 * lightweight-charts manipulates a canvas via DOM APIs not available in
 * jsdom, so we mock the entire module and focus on testing the React shell.
 *
 * Criteria:
 * 1. Symbol picker renders watchlist tickers
 * 2. Selecting a symbol marks it as active (aria-pressed)
 * 3. Chart type toggle buttons render and respond to click
 * 4. Zoom buttons render all 5 options
 * 5. TradingView link renders with correct symbol in href
 * 6. Loading skeleton shown while bars are fetching
 * 7. Empty state when watchlist is empty
 * 8. Overlay toggle buttons render
 * 9. First symbol is auto-selected when watchlist loads (no onSuccess deprecation)
 * 10. Error message references "Run Scan Now" when no bars exist for symbol
 */

import { it, expect, vi } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "./msw-server"
import ChartPage from "../pages/ChartPage"

// Mock lightweight-charts — jsdom has no canvas
vi.mock("lightweight-charts", () => ({
  createChart:       () => ({
    addSeries:      () => ({ setData: vi.fn(), applyOptions: vi.fn() }),
    removeSeries:   vi.fn(),
    applyOptions:   vi.fn(),
    timeScale:      () => ({ fitContent: vi.fn() }),
    remove:         vi.fn(),
  }),
  CandlestickSeries: {},
  LineSeries:        {},
  ColorType:         { Solid: "solid" },
}))

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ChartPage /></MemoryRouter>
    </QueryClientProvider>
  )
}

// 1. Symbol picker shows watchlist tickers
it("renders symbol picker with watchlist tickers", async () => {
  renderPage()
  await waitFor(() => expect(screen.getByRole("button", { name: "AAPL" })).toBeInTheDocument())
  expect(screen.getByRole("button", { name: "MSFT" })).toBeInTheDocument()
})

// 2. Selecting a symbol marks it active (aria-pressed)
it("selected symbol button has aria-pressed=true", async () => {
  renderPage()
  await waitFor(() => screen.getByRole("button", { name: "AAPL" }))
  const aaplBtn = screen.getByRole("button", { name: "AAPL" })
  expect(aaplBtn).toHaveAttribute("aria-pressed", "true")
})

// 3. Chart type toggle buttons
it("renders Candlestick and Line chart type buttons", async () => {
  renderPage()
  await waitFor(() => screen.getByRole("button", { name: /candlestick/i }))
  expect(screen.getByRole("button", { name: /line/i })).toBeInTheDocument()
})

it("clicking Line sets it as active chart type", async () => {
  renderPage()
  await waitFor(() => screen.getByRole("button", { name: /line/i }))
  const lineBtn = screen.getByRole("button", { name: /line/i })
  fireEvent.click(lineBtn)
  expect(lineBtn).toHaveAttribute("aria-pressed", "true")
})

// 4. All 5 zoom buttons present
it("renders all 5 zoom buttons", async () => {
  renderPage()
  await waitFor(() => screen.getByRole("button", { name: "1M" }))
  for (const label of ["1M", "3M", "6M", "1Y", "All"]) {
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument()
  }
})

// 5. TradingView link has correct symbol
it("TradingView link includes the active symbol", async () => {
  renderPage()
  await waitFor(() => screen.getByRole("link", { name: /tradingview/i }))
  const link = screen.getByRole("link", { name: /tradingview/i })
  expect(link.href).toContain("AAPL")
  expect(link).toHaveAttribute("target", "_blank")
})

// 6. Loading skeleton while bars fetch
it("shows loading skeleton while chart data is loading", async () => {
  server.use(
    http.get("http://localhost:8000/ohlcv/bars", () => new Promise(() => {}))
  )
  renderPage()
  await waitFor(() => screen.getByRole("button", { name: "AAPL" }))
  expect(screen.getByLabelText(/loading chart/i)).toBeInTheDocument()
})

// 7. Empty state when watchlist is empty
it("shows empty state when watchlist is empty", async () => {
  server.use(
    http.get("http://localhost:8000/watchlist", () => HttpResponse.json([]))
  )
  renderPage()
  await waitFor(() =>
    expect(screen.getByText(/add tickers to your watchlist/i)).toBeInTheDocument()
  )
})

// 8. Overlay toggle buttons render
it("renders BB Bands and EMAs overlay toggles", async () => {
  renderPage()
  await waitFor(() => screen.getByRole("button", { name: /bb bands/i }))
  expect(screen.getByRole("button", { name: /emas/i })).toBeInTheDocument()
})

// 9. First watchlist symbol auto-selected on load (useEffect, not deprecated onSuccess)
it("auto-selects the first watchlist symbol on load", async () => {
  renderPage()
  await waitFor(() => screen.getByRole("button", { name: "AAPL" }))
  expect(screen.getByRole("button", { name: "AAPL" })).toHaveAttribute("aria-pressed", "true")
  expect(screen.getByRole("button", { name: "MSFT" })).toHaveAttribute("aria-pressed", "false")
})

// 10. No-bars error references "Run Scan Now"
it("error message references Run Scan Now when no bars exist", async () => {
  server.use(
    http.get("http://localhost:8000/ohlcv/bars", () =>
      HttpResponse.json({ detail: "No cached bars" }, { status: 404 })
    )
  )
  renderPage()
  await waitFor(() => screen.getByRole("button", { name: "AAPL" }))
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument())
  expect(screen.getByRole("alert").textContent).toMatch(/run scan now/i)
})
