/**
 * Watchlist tests — Milestones 6d + 8.
 *
 * Criteria:
 * 1.  Watchlist items render from GET /watchlist
 * 2.  Add form submits POST /watchlist with symbol + group
 * 3.  Symbol is uppercased before submit
 * 4.  Added entry appears after success (query invalidated)
 * 5.  Remove button calls DELETE /watchlist/{symbol}
 * 6.  Empty state shown when list is empty
 * 7.  FK / 422 error on add shows friendly "run Screener first" message
 * 8.  Duplicate symbol (409/23505) error shows friendly message
 * 9.  Generic add error shows fallback message
 * 10. Remove failure shows inline error message
 */

import { it, expect, vi } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "./msw-server"
import { MOCK_WATCHLIST } from "./handlers"
import WatchlistPage from "../pages/WatchlistPage"

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><WatchlistPage /></MemoryRouter>
      </QueryClientProvider>
    ),
  }
}

// 1. Items render from GET /watchlist
it("renders watchlist entries", async () => {
  renderPage()
  await waitFor(() =>
    expect(screen.getByText("AAPL")).toBeInTheDocument()
  )
  expect(screen.getByText("MSFT")).toBeInTheDocument()
  expect(screen.getByText("JPM")).toBeInTheDocument()
})

// 2 & 3. Add form uppercases and POSTs
it("submits add form with uppercased symbol and group", async () => {
  const handler = vi.fn()
  server.use(
    http.post("http://localhost:8000/watchlist", async ({ request }) => {
      const body = await request.json()
      handler(body)
      return HttpResponse.json(
        { id: "10", symbol: body.symbol, group_name: body.group_name, added_at: new Date().toISOString() },
        { status: 201 }
      )
    })
  )

  const { user } = renderPage()
  await waitFor(() => screen.getByText("AAPL"))

  await user.type(screen.getByLabelText(/ticker symbol/i), "nvda")
  await user.type(screen.getByLabelText(/group name/i), "Tech")
  await waitFor(() => expect(screen.getByRole("button", { name: /^add$/i })).not.toBeDisabled())
  await user.click(screen.getByRole("button", { name: /^add$/i }))

  await waitFor(() => expect(handler).toHaveBeenCalledWith(
    expect.objectContaining({ symbol: "NVDA", group_name: "Tech" })
  ))
})

// 4. Added entry appears after success
it("new entry appears in list after successful add", async () => {
  // Flag flips after POST so subsequent GET /watchlist returns the updated list
  let addPosted = false
  server.use(
    http.get("http://localhost:8000/watchlist", () =>
      addPosted
        ? HttpResponse.json([
            ...MOCK_WATCHLIST,
            { id: "10", symbol: "NVDA", group_name: null, added_at: new Date().toISOString() },
          ])
        : HttpResponse.json(MOCK_WATCHLIST)
    ),
    http.post("http://localhost:8000/watchlist", async ({ request }) => {
      const body = await request.json()
      addPosted = true
      return HttpResponse.json(
        { id: "10", symbol: body.symbol, group_name: null, added_at: new Date().toISOString() },
        { status: 201 }
      )
    })
  )

  const { user } = renderPage()
  await waitFor(() => screen.getByText("AAPL"))

  await user.type(screen.getByLabelText(/ticker symbol/i), "NVDA")
  await waitFor(() => expect(screen.getByRole("button", { name: /^add$/i })).not.toBeDisabled())
  await user.click(screen.getByRole("button", { name: /^add$/i }))

  // After add + cache invalidation, the NVDA row should appear in the list
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /remove nvda/i })).toBeInTheDocument()
  )
})

// 5. Remove button opens confirm dialog → confirming calls DELETE
it("clicking remove calls DELETE /watchlist/{symbol}", async () => {
  const handler = vi.fn()
  server.use(
    http.delete("http://localhost:8000/watchlist/:symbol", ({ params }) => {
      handler(decodeURIComponent(params.symbol))
      return new HttpResponse(null, { status: 204 })
    })
  )

  const { user } = renderPage()
  await waitFor(() => screen.getByText("AAPL"))

  // Click trash → confirm dialog opens
  await user.click(screen.getByRole("button", { name: /remove aapl/i }))
  // Click the "Remove" confirm button in the dialog
  await user.click(screen.getByRole("button", { name: /^remove$/i }))
  await waitFor(() => expect(handler).toHaveBeenCalledWith("AAPL"))
})

// 6. Empty state
it("shows empty state when watchlist is empty", async () => {
  server.use(
    http.get("http://localhost:8000/watchlist", () => HttpResponse.json([]))
  )
  renderPage()
  await waitFor(() =>
    expect(screen.getByText(/your watchlist is empty/i)).toBeInTheDocument()
  )
})

// 7. FK / 422 error → "run Screener first" guidance
it("shows screener-first guidance on FK constraint violation", async () => {
  server.use(
    http.post("http://localhost:8000/watchlist", () =>
      HttpResponse.json(
        { detail: "foreign key constraint violates" },
        { status: 422 }
      )
    )
  )
  const { user } = renderPage()
  await waitFor(() => screen.getByText("AAPL"))
  await user.type(screen.getByLabelText(/ticker symbol/i), "XOM")
  await waitFor(() => expect(screen.getByRole("button", { name: /^add$/i })).not.toBeDisabled())
  await user.click(screen.getByRole("button", { name: /^add$/i }))
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toMatch(/run the screener first/i)
  )
})

// 8. Duplicate symbol → friendly message
it("shows duplicate-symbol message on 409 conflict", async () => {
  server.use(
    http.post("http://localhost:8000/watchlist", () =>
      HttpResponse.json({ detail: "duplicate key violates unique constraint 23505" }, { status: 409 })
    )
  )
  const { user } = renderPage()
  await waitFor(() => screen.getByText("AAPL"))
  await user.type(screen.getByLabelText(/ticker symbol/i), "AAPL")
  await waitFor(() => expect(screen.getByRole("button", { name: /^add$/i })).not.toBeDisabled())
  await user.click(screen.getByRole("button", { name: /^add$/i }))
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toMatch(/already in your watchlist/i)
  )
})

// 9. Generic add error → fallback message
it("shows fallback error for unexpected add failures", async () => {
  server.use(
    http.post("http://localhost:8000/watchlist", () =>
      HttpResponse.json({ detail: "Internal server error" }, { status: 500 })
    )
  )
  const { user } = renderPage()
  await waitFor(() => screen.getByText("AAPL"))
  await user.type(screen.getByLabelText(/ticker symbol/i), "XOM")
  await waitFor(() => expect(screen.getByRole("button", { name: /^add$/i })).not.toBeDisabled())
  await user.click(screen.getByRole("button", { name: /^add$/i }))
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toMatch(/failed to add symbol/i)
  )
})

// 10. Remove failure shows inline error
it("shows inline error when DELETE /watchlist/{symbol} fails", async () => {
  server.use(
    http.delete("http://localhost:8000/watchlist/:symbol", () =>
      HttpResponse.json({ detail: "Server error" }, { status: 500 })
    )
  )
  const { user } = renderPage()
  await waitFor(() => screen.getByText("AAPL"))
  // Click trash → confirm dialog opens
  await user.click(screen.getByRole("button", { name: /remove aapl/i }))
  // Click the "Remove" confirm button in the dialog
  await user.click(screen.getByRole("button", { name: /^remove$/i }))
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toMatch(/failed to remove aapl/i)
  )
})
