/**
 * Watchlist page tests.
 *
 * The Watchlist page merges ticker management (add / remove / groups) with the
 * indicator readings and the "Update Now" control that used to live on a separate
 * Scanner page. It renders a desktop table AND mobile cards, so symbols and
 * per-row buttons appear twice in jsdom — assertions use getAllBy and take [0]
 * where an element is intentionally dual-rendered.
 *
 * Covers:
 *  Management: render entries, add (uppercased), new entry appears, remove flow,
 *              empty state, FK / duplicate / generic add errors, remove failure
 *  Readings:   indicator columns + RSI/MACD colour coding, BB squeeze dots
 *  Update bar: last/next update, Update Now present + triggers scheduler, cooldown, pause
 *  Positions:  "Open" badge on a ticker you hold; plan-trade opens the exit dialog
 */

import { it, expect, vi, describe } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "./msw-server"
import { MOCK_WATCHLIST, MOCK_SCHEDULER_STATUS } from "./handlers"
import WatchlistPage from "../pages/WatchlistPage"

const API = "http://localhost:8000"

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

// ---------------------------------------------------------------------------
// Management
// ---------------------------------------------------------------------------

describe("ticker management", () => {
  it("renders watchlist entries", async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText("AAPL")[0]).toBeInTheDocument())
    expect(screen.getAllByText("MSFT")[0]).toBeInTheDocument()
    expect(screen.getAllByText("JPM")[0]).toBeInTheDocument()
  })

  it("submits add form with uppercased symbol and group", async () => {
    const handler = vi.fn()
    server.use(
      http.post(`${API}/watchlist`, async ({ request }) => {
        const body = await request.json()
        handler(body)
        return HttpResponse.json(
          { id: "10", symbol: body.symbol, group_name: body.group_name, added_at: new Date().toISOString() },
          { status: 201 }
        )
      })
    )
    const { user } = renderPage()
    await waitFor(() => screen.getAllByText("AAPL")[0])

    await user.type(screen.getByLabelText(/ticker symbol/i), "nvda")
    await user.type(screen.getByLabelText(/group name/i), "Tech")
    await waitFor(() => expect(screen.getByRole("button", { name: /^add$/i })).not.toBeDisabled())
    await user.click(screen.getByRole("button", { name: /^add$/i }))

    await waitFor(() => expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "NVDA", group_name: "Tech" })
    ))
  })

  it("new entry appears in the list after a successful add", async () => {
    let addPosted = false
    server.use(
      http.get(`${API}/watchlist`, () =>
        addPosted
          ? HttpResponse.json([...MOCK_WATCHLIST, { id: "10", symbol: "NVDA", group_name: null, added_at: new Date().toISOString() }])
          : HttpResponse.json(MOCK_WATCHLIST)
      ),
      http.post(`${API}/watchlist`, async ({ request }) => {
        const body = await request.json()
        addPosted = true
        return HttpResponse.json(
          { id: "10", symbol: body.symbol, group_name: null, added_at: new Date().toISOString() },
          { status: 201 }
        )
      })
    )
    const { user } = renderPage()
    await waitFor(() => screen.getAllByText("AAPL")[0])

    await user.type(screen.getByLabelText(/ticker symbol/i), "NVDA")
    await waitFor(() => expect(screen.getByRole("button", { name: /^add$/i })).not.toBeDisabled())
    await user.click(screen.getByRole("button", { name: /^add$/i }))

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /remove nvda/i })[0]).toBeInTheDocument()
    )
  })

  it("remove flow opens a confirm dialog then calls DELETE", async () => {
    const handler = vi.fn()
    server.use(
      http.delete(`${API}/watchlist/:symbol`, ({ params }) => {
        handler(decodeURIComponent(params.symbol))
        return new HttpResponse(null, { status: 204 })
      })
    )
    const { user } = renderPage()
    await waitFor(() => screen.getAllByText("AAPL")[0])

    await user.click(screen.getAllByRole("button", { name: /remove aapl/i })[0])
    await user.click(screen.getByRole("button", { name: /^remove$/i })) // dialog confirm
    await waitFor(() => expect(handler).toHaveBeenCalledWith("AAPL"))
  })

  it("shows an empty state when the watchlist is empty", async () => {
    server.use(http.get(`${API}/watchlist`, () => HttpResponse.json([])))
    renderPage()
    await waitFor(() =>
      expect(screen.getByText(/your watchlist is empty/i)).toBeInTheDocument()
    )
  })

  it("shows screener-first guidance on an FK constraint violation", async () => {
    server.use(
      http.post(`${API}/watchlist`, () =>
        HttpResponse.json({ detail: "foreign key constraint violates" }, { status: 422 })
      )
    )
    const { user } = renderPage()
    await waitFor(() => screen.getAllByText("AAPL")[0])
    await user.type(screen.getByLabelText(/ticker symbol/i), "XOM")
    await waitFor(() => expect(screen.getByRole("button", { name: /^add$/i })).not.toBeDisabled())
    await user.click(screen.getByRole("button", { name: /^add$/i }))
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/run the screener first/i)
    )
  })

  it("shows a duplicate-symbol message on 409", async () => {
    server.use(
      http.post(`${API}/watchlist`, () =>
        HttpResponse.json({ detail: "duplicate key violates unique constraint 23505" }, { status: 409 })
      )
    )
    const { user } = renderPage()
    await waitFor(() => screen.getAllByText("AAPL")[0])
    await user.type(screen.getByLabelText(/ticker symbol/i), "AAPL")
    await waitFor(() => expect(screen.getByRole("button", { name: /^add$/i })).not.toBeDisabled())
    await user.click(screen.getByRole("button", { name: /^add$/i }))
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/already in your watchlist/i)
    )
  })

  it("shows an inline error when remove fails", async () => {
    server.use(
      http.delete(`${API}/watchlist/:symbol`, () =>
        HttpResponse.json({ detail: "Server error" }, { status: 500 })
      )
    )
    const { user } = renderPage()
    await waitFor(() => screen.getAllByText("AAPL")[0])
    await user.click(screen.getAllByRole("button", { name: /remove aapl/i })[0])
    await user.click(screen.getByRole("button", { name: /^remove$/i }))
    await waitFor(() =>
      expect(screen.getByText(/failed to remove aapl/i)).toBeInTheDocument()
    )
  })
})

// ---------------------------------------------------------------------------
// Indicator readings (merged from the old Scanner page)
// ---------------------------------------------------------------------------

describe("indicator readings", () => {
  it("colour-codes RSI by zone", async () => {
    renderPage()
    // findAllBy waits for the snapshots query to resolve (symbols render from the
    // watchlist entries first, indicator values arrive after).
    const inRange = await screen.findAllByText("52.3")
    expect(inRange[0].className).toMatch(/green/)                     // in-range
    expect(screen.getAllByText("72.1")[0].className).toMatch(/red/)   // overbought
    expect(screen.getAllByText("28.4")[0].className).toMatch(/blue/)  // oversold
  })

  it("colour-codes MACD histogram by sign", async () => {
    renderPage()
    const positive = await screen.findAllByText("0.45")
    expect(positive[0].className).toMatch(/green/)
    expect(screen.getAllByText("-0.20")[0].className).toMatch(/red/)
  })

  it("renders BB squeeze as filled/empty dots", async () => {
    renderPage()
    await screen.findAllByText("52.3")   // wait for snapshots to land
    expect(screen.getAllByLabelText("true").length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText("false").length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Update status bar (was the Scanner's scheduler bar; "scan" → "update")
// ---------------------------------------------------------------------------

describe("update controls", () => {
  it("renders last and next update times", async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/last update/i)).toBeInTheDocument())
    expect(screen.getByText(/next update/i)).toBeInTheDocument()
  })

  it("clicking Update Now triggers POST /scheduler/trigger", async () => {
    const handler = vi.fn()
    server.use(
      http.post(`${API}/scheduler/trigger`, () => {
        handler()
        return HttpResponse.json({ message: "Scan completed", result: null })
      })
    )
    renderPage()
    const btn = await screen.findByRole("button", { name: /update watchlist now/i })
    fireEvent.click(btn)
    await waitFor(() => expect(handler).toHaveBeenCalledOnce())
  })

  it("disables Update Now while a cooldown is active", async () => {
    server.use(
      http.get(`${API}/scheduler/status`, () =>
        HttpResponse.json({ ...MOCK_SCHEDULER_STATUS, seconds_until_cooldown_expires: 1800 })
      )
    )
    renderPage()
    await waitFor(() => expect(screen.getByText(/cooldown/i)).toBeInTheDocument())
    expect(screen.getByRole("button", { name: /update watchlist now/i })).toBeDisabled()
  })

  it("shows a pause notice when the scheduler is paused", async () => {
    server.use(
      http.get(`${API}/scheduler/status`, () =>
        HttpResponse.json({ ...MOCK_SCHEDULER_STATUS, paused: true, pause_until: "2026-03-30T08:00:00Z" })
      )
    )
    renderPage()
    await waitFor(() => expect(screen.getByText(/updates paused/i)).toBeInTheDocument())
  })
})

// ---------------------------------------------------------------------------
// Position integration
// ---------------------------------------------------------------------------

describe("price + sorting", () => {
  it("shows the latest price per ticker", async () => {
    renderPage()
    // AAPL's latest close from GET /ohlcv/quotes.
    expect((await screen.findAllByText("$213.49"))[0]).toBeInTheDocument()
  })

  it("sorts rows by a column when its header is clicked, toggling direction", async () => {
    const { user } = renderPage()
    await screen.findAllByText("52.3") // snapshots loaded

    // Default sort is symbol ascending → AAPL before JPM.
    let [aapl] = screen.getAllByText("AAPL")
    let [jpm] = screen.getAllByText("JPM")
    expect(aapl.compareDocumentPosition(jpm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // Sort by RSI ascending → JPM (28.4) now comes before AAPL (52.3).
    await user.click(screen.getByRole("button", { name: /sort by rsi/i }))
    ;[aapl] = screen.getAllByText("AAPL")
    ;[jpm] = screen.getAllByText("JPM")
    expect(jpm.compareDocumentPosition(aapl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // Re-click flips to descending → MSFT (72.1) first, AAPL before JPM again.
    await user.click(screen.getByRole("button", { name: /sort by rsi/i }))
    ;[aapl] = screen.getAllByText("AAPL")
    ;[jpm] = screen.getAllByText("JPM")
    expect(aapl.compareDocumentPosition(jpm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe("position integration", () => {
  it("badges a ticker you hold an open position in", async () => {
    // MOCK_POSITIONS has an open AAPL position; the handler filters ?status=open.
    renderPage()
    await waitFor(() => expect(screen.getAllByText("Open").length).toBeGreaterThan(0))
  })

  it("opens the exit plan dialog from a row's plan button", async () => {
    const { user } = renderPage()
    await waitFor(() => screen.getAllByText("AAPL")[0])
    await user.click(screen.getAllByRole("button", { name: /plan a trade for aapl/i })[0])
    await waitFor(() =>
      expect(screen.getByText(/plan exit for/i)).toBeInTheDocument()
    )
  })
})
