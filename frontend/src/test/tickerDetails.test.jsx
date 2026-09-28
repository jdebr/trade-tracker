/**
 * Ticker details panel (M20.5): SymbolLink opens an app-wide sheet with price,
 * recent candlestick patterns (+ chart markers), signals, indicators and the
 * open position — all from one /tickers/{symbol}/details call.
 */

import { it, expect, vi, describe } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "./msw-server"
import TickerDetailsProvider from "../components/TickerDetailsProvider"
import { SymbolLink } from "../components/SymbolLink"
import { patternMarkers, groupPatternsByDate } from "../lib/tickerDetails"

const setMarkers = vi.fn()
vi.mock("lightweight-charts", () => ({
  createChart: () => ({
    addSeries:    () => ({ setData: vi.fn(), applyOptions: vi.fn() }),
    removeSeries: vi.fn(),
    applyOptions: vi.fn(),
    timeScale:    () => ({ fitContent: vi.fn() }),
    remove:       vi.fn(),
  }),
  createSeriesMarkers: () => ({ setMarkers: (...a) => setMarkers(...a) }),
  CandlestickSeries: {},
  LineSeries:        {},
  ColorType:         { Solid: "solid" },
}))

const API = "http://localhost:8000"

const PATTERNS = [
  { date: "2026-09-25", name: "cdl_harami_bull", label: "Harami (bullish)", direction: "bullish", meaning: "Momentum is stalling." },
  { date: "2026-09-25", name: "cdl_doji", label: "Doji", direction: "neutral", meaning: "Indecision." },
  { date: "2026-09-22", name: "cdl_shooting_star", label: "Shooting Star", direction: "bearish", meaning: "Possible top." },
]

const DETAILS = {
  symbol: "AAPL", name: "Apple Inc.", sector: "Information Technology", industry: "Hardware",
  in_watchlist: false,
  last: { date: "2026-09-25", close: 231.1, change: 2.5, change_pct: 1.09 },
  bars: [{ date: "2026-09-25", open: 229, high: 232, low: 228, close: 231.1, volume: 1e6 }],
  pattern_days: 10,
  patterns: PATTERNS,
  snapshot: { symbol: "AAPL", date: "2026-09-25", rsi_14: 48.2, macd_hist: 0.12, bb_squeeze: true,
              ema_8: 230, ema_21: 228, ema_50: 220, atr_14: 3.4 },
  signals: { score: 2, max: 3, normalized: 0.67, rules: [
    { slug: "oversold", name: "RSI oversold", weight: 2, fired: true, formatted: "RSI(14) < 50" },
    { slug: "squeeze", name: "BB Squeeze", weight: 1, fired: false, formatted: "BB Squeeze" },
  ] },
  position: { id: "p1", is_simulated: true, entry_date: "2026-09-10", entry_price: 220, shares: 10,
              stop_price: 212, target_price: 240, r_now: 1.39 },
}

function renderWithPanel(ui = <SymbolLink symbol="AAPL" name="Apple Inc." />) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><TickerDetailsProvider>{ui}</TickerDetailsProvider></MemoryRouter>
      </QueryClientProvider>
    ),
  }
}

function serve(details = DETAILS) {
  server.use(http.get(`${API}/tickers/:symbol/details`, () => HttpResponse.json(details)))
}

async function openPanel(user) {
  await user.click(screen.getByRole("button", { name: "AAPL" }))
  return screen.findByRole("dialog")
}

describe("ticker details panel", () => {
  it("opens from a symbol and shows every section", async () => {
    serve()
    const { user } = renderWithPanel()
    const dialog = await openPanel(user)
    const d = within(dialog)

    expect(await d.findByText("Apple Inc.")).toBeInTheDocument()
    expect(d.getByText("$231.10")).toBeInTheDocument()
    expect(d.getByText(/\+2\.50 \(\+1\.09%\)/)).toBeInTheDocument()

    // Recent candles: grouped by day, each with its meaning
    expect(d.getByText("Harami (bullish)")).toBeInTheDocument()
    expect(d.getByText("Possible top.")).toBeInTheDocument()
    expect(d.getByLabelText(/candlestick chart with pattern markers/i)).toBeInTheDocument()

    // Signals with fired / not fired
    expect(d.getByLabelText("Signal score 2 of 3")).toBeInTheDocument()
    expect(d.getByText("RSI oversold")).toBeInTheDocument()
    expect(d.getByLabelText("fired")).toBeInTheDocument()
    expect(d.getByLabelText("didn't fire")).toBeInTheDocument()

    // Indicators and position
    expect(d.getByText("48.2")).toBeInTheDocument()
    expect(d.getByText("+5.0%")).toBeInTheDocument()               // close vs EMA 50
    expect(d.getByText("+1.39R")).toBeInTheDocument()

    // Links out
    expect(d.getByRole("link", { name: /full chart/i })).toHaveAttribute("href", "/chart?symbol=AAPL")
  })

  it("puts one marker per day and direction on the mini chart", async () => {
    serve()
    setMarkers.mockClear()
    const { user } = renderWithPanel()
    await openPanel(user)
    await waitFor(() => expect(setMarkers).toHaveBeenCalled())
    const markers = setMarkers.mock.calls.at(-1)[0]
    expect(markers.map((m) => [m.time, m.shape])).toEqual([
      ["2026-09-22", "arrowDown"], ["2026-09-25", "arrowUp"], ["2026-09-25", "circle"],
    ])
  })

  it("says so when no patterns formed and there's no data to score", async () => {
    serve({ ...DETAILS, patterns: [], snapshot: null, signals: null, position: null })
    const { user } = renderWithPanel()
    const d = within(await openPanel(user))
    expect(await d.findByText(/no curated patterns formed in the last 10 sessions/i)).toBeInTheDocument()
    expect(d.getByText(/signals can't be scored/i)).toBeInTheDocument()
    expect(d.queryByText(/open position/i)).not.toBeInTheDocument()
  })

  it("adds a ticker to the watchlist from the panel", async () => {
    serve()
    let posted
    server.use(http.post(`${API}/watchlist`, async ({ request }) => {
      posted = await request.json()
      return HttpResponse.json({ id: "9", symbol: "AAPL", group_name: null }, { status: 201 })
    }))
    const { user } = renderWithPanel()
    const d = within(await openPanel(user))
    await user.click(await d.findByRole("button", { name: /add to watchlist/i }))
    await waitFor(() => expect(posted).toEqual({ symbol: "AAPL", group_name: null }))
  })

  it("shows an error with retry", async () => {
    server.use(http.get(`${API}/tickers/:symbol/details`, () => HttpResponse.json({ detail: "boom" }, { status: 500 })))
    const { user } = renderWithPanel()
    const d = within(await openPanel(user))
    expect(await d.findByText(/couldn't load details for AAPL/i)).toBeInTheDocument()
    serve()
    await user.click(d.getByRole("button", { name: /try again/i }))
    expect(await d.findByText("Apple Inc.")).toBeInTheDocument()
  })

  it("closes with Escape", async () => {
    serve()
    const { user } = renderWithPanel()
    await openPanel(user)
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })
})

describe("SymbolLink", () => {
  it("is plain text outside the provider", () => {
    render(<SymbolLink symbol="MSFT" />)
    expect(screen.getByText("MSFT").tagName).toBe("SPAN")
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})

describe("pattern helpers", () => {
  it("dedupes markers per day + direction and sorts oldest first", () => {
    const m = patternMarkers([...PATTERNS, { ...PATTERNS[0], name: "cdl_hammer" }])
    expect(m).toHaveLength(3)
    expect(m[0].time).toBe("2026-09-22")
  })

  it("groups history by date, newest first", () => {
    const g = groupPatternsByDate(PATTERNS)
    expect(g.map((x) => [x.date, x.patterns.length])).toEqual([["2026-09-25", 2], ["2026-09-22", 1]])
  })
})
