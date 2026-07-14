/**
 * Position tracking + exit strategy builder tests.
 *
 * Covers:
 *  1. PositionsPage renders open and closed positions
 *  2. Simulated vs real positions are visually distinguishable
 *  3. Unrealized R is computed from the live quote
 *  4. Closing a position previews the outcome, then POSTs
 *  5. ExitPlanDialog shows stop/target/sizing from POST /positions/plan
 *  6. ExitPlanDialog surfaces warnings and blocks a 0-share plan
 *  7. ExitPlanDialog defaults to a simulated position
 *  8. ReportsPage renders headline metrics and signal attribution
 *  9. SettingsPage loads and saves defaults
 */

import { it, expect, describe } from "vitest"
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "./msw-server"
import { MOCK_EXIT_PLAN } from "./handlers"
import PositionsPage from "../pages/PositionsPage"
import ReportsPage from "../pages/ReportsPage"
import SettingsPage from "../pages/SettingsPage"
import ExitPlanDialog from "../components/ExitPlanDialog"

const API = "http://localhost:8000"

function renderWithProviders(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

// ---------------------------------------------------------------------------
// PositionsPage
// ---------------------------------------------------------------------------

describe("PositionsPage", () => {
  it("renders open and closed positions in separate sections", async () => {
    renderWithProviders(<PositionsPage />)

    await waitFor(() => expect(screen.getByText("Open (1)")).toBeInTheDocument())
    expect(screen.getByText("Closed (1)")).toBeInTheDocument()
    expect(screen.getByText("AAPL")).toBeInTheDocument()
    expect(screen.getByText("MSFT")).toBeInTheDocument()
  })

  it("distinguishes simulated from real positions", async () => {
    renderWithProviders(<PositionsPage />)

    // AAPL is simulated, MSFT is real — the distinction has to be visible or the
    // performance record is meaningless.
    await waitFor(() => expect(screen.getByText("SIM")).toBeInTheDocument())
    expect(screen.getByText("LIVE")).toBeInTheDocument()
  })

  it("computes unrealized R from the current quote", async () => {
    renderWithProviders(<PositionsPage />)

    // AAPL: entry 100, stop 94 → 1R = $6/share. Quote 106 → +1.00R
    await waitFor(() => expect(screen.getByText("+1.00R")).toBeInTheDocument())
  })

  it("shows the realized R of a closed trade", async () => {
    renderWithProviders(<PositionsPage />)

    // MSFT closed at its 2R target.
    await waitFor(() => expect(screen.getByText("+2.00R")).toBeInTheDocument())
    expect(screen.getByText("Target hit")).toBeInTheDocument()
  })

  it("previews the outcome before closing a position", async () => {
    renderWithProviders(<PositionsPage />)

    await waitFor(() => expect(screen.getByText("Open (1)")).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "Close" }))

    await waitFor(() => expect(screen.getByLabelText("Exit price")).toBeInTheDocument())

    // Exit at 112 on entry 100 / stop 94 → +$192 on 16 shares, a clean 2R.
    fireEvent.change(screen.getByLabelText("Exit price"), { target: { value: "112" } })

    // Scoped to the dialog: the closed MSFT row behind it also reads +2.00R.
    const dialog = within(screen.getByRole("dialog"))
    await waitFor(() => expect(dialog.getByText(/\+\$192\.00/)).toBeInTheDocument())
    expect(dialog.getByText(/\+2\.00R/)).toBeInTheDocument()
  })

  it("shows an empty state when there are no positions", async () => {
    server.use(http.get(`${API}/positions`, () => HttpResponse.json([])))
    renderWithProviders(<PositionsPage />)

    await waitFor(() =>
      expect(screen.getByText(/No positions yet/i)).toBeInTheDocument()
    )
  })
})

// ---------------------------------------------------------------------------
// ExitPlanDialog
// ---------------------------------------------------------------------------

describe("ExitPlanDialog", () => {
  function renderDialog(props = {}) {
    return renderWithProviders(
      <ExitPlanDialog
        open
        onOpenChange={() => {}}
        symbol="AAPL"
        suggestedEntry={100}
        {...props}
      />
    )
  }

  // The same price appears in both the summary and the comparison table (a 2x ATR
  // stop IS the 94.00 the table lists), so assertions scope to one region.
  async function summary() {
    return within(
      await screen.findByRole("group", { name: "Exit plan summary" })
    )
  }

  it("shows the computed stop, target, sizing and reward-to-risk", async () => {
    renderDialog()
    const s = await summary()

    expect(s.getByText("$94.00")).toBeInTheDocument()    // stop
    expect(s.getByText("$112.00")).toBeInTheDocument()   // target
    expect(s.getByText("16")).toBeInTheDocument()        // shares
    expect(s.getByText("2.00 : 1")).toBeInTheDocument()  // reward : risk
  })

  it("shows alternative stop levels side by side", async () => {
    renderDialog()

    // The comparison table is what makes this a builder rather than a black box.
    const stops = within(
      await screen.findByRole("group", { name: "Compare stop levels" })
    )
    expect(stops.getByText("Swing Low")).toBeInTheDocument()
    expect(stops.getByText("$90.00")).toBeInTheDocument()
    expect(stops.getByText("EMA 21")).toBeInTheDocument()
  })

  it("defaults to a simulated position", async () => {
    renderDialog()
    await summary()   // wait for the plan to land before checking the button

    expect(screen.getByText("Simulated")).toBeInTheDocument()
    // Real money is opt-in: the checkbox starts unchecked.
    expect(screen.getByLabelText("Real money position")).not.toBeChecked()
    expect(
      screen.getByRole("button", { name: /Open simulated position/i })
    ).toBeEnabled()
  })

  it("surfaces plan warnings", async () => {
    server.use(
      http.post(`${API}/positions/plan`, () =>
        HttpResponse.json({
          ...MOCK_EXIT_PLAN,
          rr_ratio: 1.2,
          warnings: ["Reward-to-risk is 1.20:1, below the 1.5:1 minimum."],
        })
      )
    )
    renderDialog()

    await waitFor(() =>
      expect(screen.getByText(/below the 1.5:1 minimum/)).toBeInTheDocument()
    )
  })

  it("blocks opening a position the risk budget can't fund", async () => {
    server.use(
      http.post(`${API}/positions/plan`, () =>
        HttpResponse.json({
          ...MOCK_EXIT_PLAN,
          shares: 0,
          warnings: ["Risk budget is too small — this trade would be 0 shares."],
        })
      )
    )
    renderDialog()

    await waitFor(() => expect(screen.getByText(/0 shares/)).toBeInTheDocument())
    expect(
      screen.getByRole("button", { name: /Open simulated position/i })
    ).toBeDisabled()
  })

  it("surfaces a validation error from the server verbatim", async () => {
    server.use(
      http.post(`${API}/positions/plan`, () =>
        HttpResponse.json(
          { detail: "Stop (105.00) must be below the entry price (100.00) for a long position." },
          { status: 400 }
        )
      )
    )
    renderDialog()

    await waitFor(() =>
      expect(screen.getByText(/must be below the entry price/)).toBeInTheDocument()
    )
  })
})

// ---------------------------------------------------------------------------
// ReportsPage
// ---------------------------------------------------------------------------

describe("ReportsPage", () => {
  it("renders the headline performance metrics", async () => {
    renderWithProviders(<ReportsPage />)

    await waitFor(() => expect(screen.getByText("$400.00")).toBeInTheDocument())  // total P&L
    expect(screen.getByText("60%")).toBeInTheDocument()                           // win rate
    expect(screen.getByText("$80.00")).toBeInTheDocument()                        // expectancy
    expect(screen.getByText("+0.80R")).toBeInTheDocument()                        // avg R
  })

  it("shows which signals are working, with the edge", async () => {
    renderWithProviders(<ReportsPage />)

    await waitFor(() =>
      expect(screen.getByText("Which signals are working")).toBeInTheDocument()
    )
    expect(screen.getByText("BB Squeeze")).toBeInTheDocument()
    expect(screen.getByText("+3.00R")).toBeInTheDocument()   // bb_squeeze edge
    expect(screen.getByText("-3.00R")).toBeInTheDocument()   // volume_expansion edge
  })

  it("warns when the sample is too thin to draw conclusions from", async () => {
    renderWithProviders(<ReportsPage />)

    await waitFor(() =>
      expect(screen.getByText(/indicative at best/i)).toBeInTheDocument()
    )
  })

  it("defaults to simulated results", async () => {
    renderWithProviders(<ReportsPage />)

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Simulated" })).toHaveAttribute(
        "aria-selected", "true"
      )
    )
  })

  it("warns that combined results don't describe a real strategy", async () => {
    renderWithProviders(<ReportsPage />)

    await waitFor(() => expect(screen.getByRole("tab", { name: "Combined" })).toBeInTheDocument())
    fireEvent.click(screen.getByRole("tab", { name: "Combined" }))

    await waitFor(() =>
      expect(screen.getByText(/doesn't describe a strategy you actually ran/i)).toBeInTheDocument()
    )
  })

  it("shows an empty state when nothing has been closed", async () => {
    server.use(
      http.get(`${API}/reports/performance`, () =>
        HttpResponse.json({
          filters: {},
          performance: { total_trades: 0, sample_is_thin: true },
          by_exit_reason: [],
          by_signal_score: [],
        })
      )
    )
    renderWithProviders(<ReportsPage />)

    await waitFor(() =>
      expect(screen.getByText(/No closed simulated trades yet/i)).toBeInTheDocument()
    )
  })
})

// ---------------------------------------------------------------------------
// SettingsPage
// ---------------------------------------------------------------------------

describe("SettingsPage", () => {
  it("loads the current defaults into the form", async () => {
    renderWithProviders(<SettingsPage />)

    await waitFor(() =>
      expect(screen.getByLabelText("Account size")).toHaveValue(10000)
    )
    expect(screen.getByLabelText("Risk per trade percent")).toHaveValue(1)
    expect(screen.getByLabelText("Default ATR multiplier")).toHaveValue(2)
  })

  it("saves an edited setting", async () => {
    renderWithProviders(<SettingsPage />)

    await waitFor(() => expect(screen.getByLabelText("Account size")).toHaveValue(10000))

    fireEvent.change(screen.getByLabelText("Account size"), { target: { value: "25000" } })
    fireEvent.click(screen.getByRole("button", { name: /Save settings/i }))

    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument())
  })
})
