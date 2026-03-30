/**
 * Milestone 8 scanner tests — scheduler status bar + Run Scan Now.
 *
 * Criteria:
 *  1. Snapshot rows render for each watchlist symbol
 *  2. RSI colour-coded: green 35–65, red ≥70, blue ≤30
 *  3. BB Squeeze renders as filled/empty dot
 *  4. MACD hist is green when positive, red when negative
 *  5. Loading skeleton shown while fetching
 *  6. Empty state when watchlist is empty
 *  7. No-snapshot state shows "Run Scan Now" guidance (not a dead-end message)
 *  8. Scheduler status bar renders last-scan and next-scan info
 *  9. "Run Scan Now" button is present
 * 10. Clicking "Run Scan Now" calls POST /scheduler/trigger
 * 11. "Run Scan Now" shows disabled + cooldown message when cooldown is active
 * 12. Paused scheduler shows pause notice in status bar
 * 13. Fetch error shows alert + Retry button
 */

import { it, expect, vi } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "./msw-server"
import { MOCK_SNAPSHOTS, MOCK_SCHEDULER_STATUS } from "./handlers"
import ScannerPage from "../pages/ScannerPage"

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ScannerPage /></MemoryRouter>
    </QueryClientProvider>
  )
}

// 1. Rows render
it("renders a row for each snapshot", async () => {
  renderPage()
  for (const snap of MOCK_SNAPSHOTS) {
    await waitFor(() => expect(screen.getAllByText(snap.symbol)[0]).toBeInTheDocument())
  }
})

// 2. RSI colour-coding
it("RSI in-range (35–65) gets green colour class", async () => {
  renderPage()
  await waitFor(() => screen.getAllByText("AAPL")[0])
  expect(screen.getAllByText("52.3")[0].className).toMatch(/green/)
})

it("RSI overbought (≥70) gets red colour class", async () => {
  renderPage()
  await waitFor(() => screen.getAllByText("MSFT")[0])
  expect(screen.getAllByText("72.1")[0].className).toMatch(/red/)
})

it("RSI oversold (≤30) gets blue colour class", async () => {
  renderPage()
  await waitFor(() => screen.getAllByText("JPM")[0])
  expect(screen.getAllByText("28.4")[0].className).toMatch(/blue/)
})

// 3. BB Squeeze dots
it("BB Squeeze dot reflects true/false state", async () => {
  renderPage()
  await waitFor(() => screen.getAllByText("AAPL")[0])
  expect(screen.getAllByLabelText("true").length).toBeGreaterThan(0)
  expect(screen.getAllByLabelText("false").length).toBeGreaterThan(0)
})

// 4. MACD hist colour
it("positive MACD hist gets green colour class", async () => {
  renderPage()
  await waitFor(() => screen.getAllByText("AAPL")[0])
  expect(screen.getAllByText("0.45")[0].className).toMatch(/green/)
})

it("negative MACD hist gets red colour class", async () => {
  renderPage()
  await waitFor(() => screen.getAllByText("MSFT")[0])
  expect(screen.getAllByText("-0.20")[0].className).toMatch(/red/)
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

// 7. No-snapshot state references "Run Scan Now"
it("no-snapshot empty state references Run Scan Now", async () => {
  server.use(
    http.get("http://localhost:8000/indicators/snapshots", () => HttpResponse.json([]))
  )
  renderPage()
  await waitFor(() =>
    expect(screen.getByText(/no indicator snapshots found/i)).toBeInTheDocument()
  )
  // Both the empty-state text and the button mention "Run Scan Now" — at least one exists
  expect(screen.getAllByText(/run scan now/i).length).toBeGreaterThanOrEqual(1)
})

// 8. Scheduler status bar shows last/next scan times
it("scheduler status bar renders last and next scan info", async () => {
  renderPage()
  await waitFor(() =>
    expect(screen.getByText(/last scan/i)).toBeInTheDocument()
  )
  expect(screen.getByText(/next scan/i)).toBeInTheDocument()
})

// 9. Run Scan Now button present
it("renders Run Scan Now button", async () => {
  renderPage()
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /run scan now/i })).toBeInTheDocument()
  )
})

// 10. Clicking Run Scan Now triggers POST /scheduler/trigger
it("clicking Run Scan Now calls POST /scheduler/trigger", async () => {
  const handler = vi.fn()
  server.use(
    http.post("http://localhost:8000/scheduler/trigger", () => {
      handler()
      return HttpResponse.json({ message: "Scan completed", result: null })
    })
  )
  renderPage()
  await waitFor(() => screen.getByRole("button", { name: /run scan now/i }))
  fireEvent.click(screen.getByRole("button", { name: /run scan now/i }))
  await waitFor(() => expect(handler).toHaveBeenCalledOnce())
})

// 11. Cooldown disables the button — wait for status to load then check disabled state
it("Run Scan Now is disabled when cooldown is active", async () => {
  server.use(
    http.get("http://localhost:8000/scheduler/status", () =>
      HttpResponse.json({ ...MOCK_SCHEDULER_STATUS, seconds_until_cooldown_expires: 1800 })
    )
  )
  renderPage()
  // Wait until the cooldown label appears (status has loaded)
  await waitFor(() =>
    expect(screen.getByText(/cooldown/i)).toBeInTheDocument()
  )
  expect(screen.getByRole("button", { name: /run scan now/i })).toBeDisabled()
})

// 12. Paused scheduler shows notice
it("shows pause notice when scheduler is paused", async () => {
  server.use(
    http.get("http://localhost:8000/scheduler/status", () =>
      HttpResponse.json({
        ...MOCK_SCHEDULER_STATUS,
        paused: true,
        pause_until: "2026-03-30T08:00:00Z",
      })
    )
  )
  renderPage()
  await waitFor(() =>
    expect(screen.getByText(/scheduler paused/i)).toBeInTheDocument()
  )
})

// 13. Fetch error shows alert + Retry button
it("shows error alert and Retry button on snapshot fetch failure", async () => {
  server.use(
    http.get("http://localhost:8000/indicators/snapshots", () =>
      HttpResponse.json({ detail: "DB error" }, { status: 500 })
    )
  )
  renderPage()
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument())
  expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument()
})
