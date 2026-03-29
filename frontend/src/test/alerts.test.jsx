/**
 * Milestone 6g alerts tests.
 *
 * Criteria:
 * 1. Alert cards render from GET /alerts
 * 2. alert_type renders as a human-readable badge
 * 3. Acknowledge button calls PATCH /alerts/{id}/acknowledge
 * 4. Alert disappears after acknowledgement (query invalidated)
 * 5. "Clear All" calls POST /alerts/acknowledge-all
 * 6. Empty state shown when no unacknowledged alerts
 */

import { it, expect, vi } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "./msw-server"
import { MOCK_ALERTS } from "./handlers"
import AlertsPage from "../pages/AlertsPage"

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><AlertsPage /></MemoryRouter>
    </QueryClientProvider>
  )
}

// 1. Alert cards render
it("renders a card for each alert", async () => {
  renderPage()
  await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument())
  expect(screen.getByText("MSFT")).toBeInTheDocument()
  expect(screen.getByText("NVDA")).toBeInTheDocument()
})

// 2. alert_type badge renders human label
it("renders human-readable alert type badges", async () => {
  renderPage()
  await waitFor(() => screen.getByText("AAPL"))
  expect(screen.getByText("BB Squeeze")).toBeInTheDocument()
  expect(screen.getByText("RSI Oversold")).toBeInTheDocument()
  expect(screen.getByText("MACD Crossover")).toBeInTheDocument()
})

// 3. Acknowledge button calls correct endpoint
it("clicking acknowledge calls PATCH /alerts/{id}/acknowledge", async () => {
  const handler = vi.fn()
  server.use(
    http.patch("http://localhost:8000/alerts/:id/acknowledge", ({ params }) => {
      handler(params.id)
      return HttpResponse.json({ id: params.id, acknowledged: true })
    })
  )

  renderPage()
  await waitFor(() => screen.getByText("AAPL"))

  fireEvent.click(screen.getByRole("button", { name: /acknowledge alert for aapl/i }))
  await waitFor(() => expect(handler).toHaveBeenCalledWith("alert-1"))
})

// 4. Alert disappears after acknowledgement
it("alert is removed from list after acknowledgement", async () => {
  let callCount = 0
  server.use(
    http.get("http://localhost:8000/alerts", () => {
      callCount++
      if (callCount === 1) return HttpResponse.json(MOCK_ALERTS)
      return HttpResponse.json(MOCK_ALERTS.filter((a) => a.id !== "alert-1"))
    }),
    http.patch("http://localhost:8000/alerts/:id/acknowledge", ({ params }) =>
      HttpResponse.json({ id: params.id, acknowledged: true })
    )
  )

  renderPage()
  await waitFor(() => screen.getByText("AAPL"))

  fireEvent.click(screen.getByRole("button", { name: /acknowledge alert for aapl/i }))
  await waitFor(() => expect(screen.queryByText("AAPL")).not.toBeInTheDocument())
})

// 5. Clear All calls POST /alerts/acknowledge-all
it("Clear All button calls POST /alerts/acknowledge-all", async () => {
  const handler = vi.fn()
  server.use(
    http.post("http://localhost:8000/alerts/acknowledge-all", () => {
      handler()
      return HttpResponse.json({ acknowledged_count: 3 })
    })
  )

  renderPage()
  await waitFor(() => screen.getByText("AAPL"))

  fireEvent.click(screen.getByRole("button", { name: /clear all/i }))
  await waitFor(() => expect(handler).toHaveBeenCalledOnce())
})

// 6. Empty state
it("shows empty state when no unacknowledged alerts", async () => {
  server.use(
    http.get("http://localhost:8000/alerts", () => HttpResponse.json([]))
  )
  renderPage()
  await waitFor(() =>
    expect(screen.getByText(/no unacknowledged alerts/i)).toBeInTheDocument()
  )
})
