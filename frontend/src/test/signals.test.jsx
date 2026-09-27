/**
 * Signals management page tests (M19b.2).
 *
 * Criteria:
 * 1. Renders a row per active signal from GET /signal-rules
 * 2. Shows the server-formatted expression
 * 3. Builtin badge is shown for seeded rules
 * 4. Toggling the light calls PATCH /signal-rules/:id with the flipped enabled
 * 5. "New signal" opens the builder dialog
 * 6. Create button is disabled until name + a valid expression are present
 * 7. A valid JSON expression shows "Valid" and enables Create; saving calls POST
 * 8. Removing a signal opens a confirm dialog, then calls DELETE on confirm
 * 9. Builtin delete confirmation warns about the legacy Screener column
 * 10. New signal opens in the visual builder by default
 * 11. Building a condition in the builder saves the right JsonLogic
 * 12. Switching to JSON shows the builder's expression as text
 * 13. Editing sends `type` (and never `expression`) in the PATCH body
 * 14. Cancel in the expression editor discards its edits
 * 15. Weight keystrokes are filtered; out-of-range shows red and blocks saving
 * 16. A server 422 surfaces the actual field error, not a generic expression message
 * 17. Search filters the list; sort reorders it
 * 18. Apply is blocked while a builder row is unfinished (no silent drop)
 * 19. Escape in the editor never discards edits
 * 20. Closing a pill with Enter returns focus to the pill
 * 21. A universe result is hidden once the expression changes
 */

import { it, expect, vi } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "./msw-server"
import { MOCK_SIGNAL_RULES } from "./handlers"
import SignalsPage from "../pages/SignalsPage"
import { friendlyError } from "../lib/signalRuleErrors"

const API = "http://localhost:8000"

/**
 * Choose an option from a themed (Radix) dropdown. Builder pills open their
 * list on mount; otherwise click the trigger first.
 */
/** Close an auto-opened pill list (the builder opens its first slot's list). */
async function dismissList() {
  if (screen.queryByRole("listbox")) await userEvent.keyboard("{Escape}")
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument())
}

async function pick(label, option) {
  // An open list marks the rest of the page aria-hidden (modal, like a native
  // select), so look the trigger up including hidden elements.
  const trigger = await screen.findByRole("combobox", { name: label, hidden: true })
  if (trigger.getAttribute("aria-expanded") !== "true") await userEvent.click(trigger)
  await userEvent.click(await screen.findByRole("option", { name: option }))
}

function renderSignals() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><SignalsPage /></MemoryRouter>
    </QueryClientProvider>
  )
}

// 1. Row per active signal
it("renders a row for each active signal", async () => {
  renderSignals()
  await waitFor(() => expect(screen.getByText("Momentum Pop")).toBeInTheDocument())
  // "BB Squeeze" appears twice (name + its formatted expression), so match loosely.
  expect(screen.getAllByText("BB Squeeze").length).toBeGreaterThan(0)
  expect(screen.getByText("Above EMA 50")).toBeInTheDocument()
})

// 2. Formatted expression shown
it("shows the server-formatted expression", async () => {
  renderSignals()
  await waitFor(() => expect(screen.getByText("35 <= RSI(14) <= 65")).toBeInTheDocument())
})

// 3. Builtin badge
it("shows the builtin badge for seeded rules", async () => {
  renderSignals()
  await waitFor(() => screen.getByText("Momentum Pop"))
  expect(screen.getAllByText("builtin").length).toBe(
    MOCK_SIGNAL_RULES.filter((r) => r.is_builtin).length
  )
})

// 4. Toggle calls PATCH with flipped enabled
it("toggling a signal's light calls PATCH with the flipped enabled flag", async () => {
  const patched = vi.fn()
  server.use(
    http.patch(`${API}/signal-rules/:id`, async ({ request, params }) => {
      patched(await request.json())
      const base = MOCK_SIGNAL_RULES.find((r) => r.id === params.id)
      return HttpResponse.json({ ...base, enabled: false })
    })
  )
  renderSignals()
  await waitFor(() => screen.getByText("Momentum Pop"))
  // First switch corresponds to the first active rule (enabled → disable).
  fireEvent.click(screen.getAllByRole("switch")[0])
  await waitFor(() => expect(patched).toHaveBeenCalledWith({ enabled: false }))
})

// 5. New signal opens the dialog
it("opens the builder dialog from New signal", async () => {
  renderSignals()
  await waitFor(() => screen.getByText("Momentum Pop"))
  fireEvent.click(screen.getByRole("button", { name: /new signal/i }))
  expect(await screen.findByLabelText(/signal name/i)).toBeInTheDocument()
})

// 6. Create disabled until name + valid expression
it("keeps Create disabled until a name and valid expression are entered", async () => {
  renderSignals()
  await waitFor(() => screen.getByText("Momentum Pop"))
  fireEvent.click(screen.getByRole("button", { name: /new signal/i }))
  await screen.findByLabelText(/signal name/i)
  expect(screen.getByRole("button", { name: /create signal/i })).toBeDisabled()
})

// 7. Valid expression → "Valid", Create enabled, save posts
it("enables Create when the expression validates and saves via POST", async () => {
  const created = vi.fn()
  server.use(
    http.post(`${API}/signal-rules`, async ({ request }) => {
      created(await request.json())
      return HttpResponse.json({ id: "sr-new", slug: "s", name: "x", expression: {}, weight: 1, enabled: true, is_builtin: false, sort_order: 9, formatted: "RSI(14) < 30", created_at: "x", updated_at: "x", deleted_at: null }, { status: 201 })
    })
  )
  renderSignals()
  await waitFor(() => screen.getByText("Momentum Pop"))
  fireEvent.click(screen.getByRole("button", { name: /new signal/i }))

  fireEvent.change(await screen.findByLabelText(/signal name/i), { target: { value: "Strong oversold" } })
  // Open the expression editor, drop to the raw-JSON escape hatch, type it.
  fireEvent.click(screen.getByRole("button", { name: /build expression/i }))
  await dismissList()
  fireEvent.click(screen.getByRole("button", { name: /^json$/i }))
  fireEvent.change(await screen.findByLabelText(/expression json/i), {
    target: { value: '{"<": [{"var": "rsi_14"}, 30]}' },
  })

  // Validation is debounced; wait for the "Valid" panel.
  await waitFor(() => expect(screen.getByText(/^Valid$/)).toBeInTheDocument(), { timeout: 3000 })
  fireEvent.click(screen.getByRole("button", { name: /apply expression/i }))
  const createBtn = screen.getByRole("button", { name: /create signal/i })
  await waitFor(() => expect(createBtn).toBeEnabled())
  fireEvent.click(createBtn)
  await waitFor(() => expect(created).toHaveBeenCalledOnce())
})

// 8. Delete flow: confirm dialog → DELETE
it("removing a signal confirms then calls DELETE", async () => {
  const deleted = vi.fn()
  server.use(
    http.delete(`${API}/signal-rules/:id`, ({ params }) => {
      deleted(params.id)
      return HttpResponse.json({ ...MOCK_SIGNAL_RULES[4], enabled: false, deleted_at: "2026-03-29T00:00:00Z" })
    })
  )
  renderSignals()
  await waitFor(() => screen.getByText("Momentum Pop"))
  fireEvent.click(screen.getByRole("button", { name: /remove momentum pop/i }))
  // Confirm dialog
  const confirm = await screen.findByText(/remove "momentum pop"\?/i)
  expect(confirm).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: /^remove$/i }))
  await waitFor(() => expect(deleted).toHaveBeenCalledWith("sr-5"))
})

// 9. Builtin delete warns about the legacy column
it("warns about the legacy Screener column when removing a builtin", async () => {
  renderSignals()
  await waitFor(() => screen.getByText("Momentum Pop"))
  fireEvent.click(screen.getByRole("button", { name: /remove bb squeeze/i }))
  expect(await screen.findByText(/legacy column/i)).toBeInTheDocument()
})

// 10. New signal defaults to the visual builder
it("opens a new signal in the visual builder by default", async () => {
  renderSignals()
  await waitFor(() => screen.getByText("Momentum Pop"))
  fireEvent.click(screen.getByRole("button", { name: /new signal/i }))
  fireEvent.click(await screen.findByRole("button", { name: /build expression/i }))
  // A fresh builder opens straight onto its first slot's picker.
  // …with its (themed) list already open.
  expect(await screen.findByRole("listbox")).toBeInTheDocument()
  expect(screen.getByRole("option", { name: "RSI(14)" })).toBeInTheDocument()
  await dismissList()
  expect(screen.getByRole("button", { name: /add condition/i })).toBeInTheDocument()
})

// 11. Building a condition emits the right JsonLogic on save
it("builds a condition in the visual builder and saves it as JsonLogic", async () => {
  const created = vi.fn()
  server.use(
    http.post(`${API}/signal-rules`, async ({ request }) => {
      created(await request.json())
      return HttpResponse.json({ id: "sr-new", slug: "s", name: "x", expression: {}, weight: 1, enabled: true, is_builtin: false, sort_order: 9, formatted: "RSI(14) < 30", created_at: "x", updated_at: "x", deleted_at: null }, { status: 201 })
    })
  )
  renderSignals()
  await waitFor(() => screen.getByText("Momentum Pop"))
  fireEvent.click(screen.getByRole("button", { name: /new signal/i }))
  fireEvent.change(await screen.findByLabelText(/signal name/i), { target: { value: "Oversold" } })
  fireEvent.click(screen.getByRole("button", { name: /build expression/i }))

  // Each pick auto-advances to the next empty slot.
  await pick("Condition 1 variable", "RSI(14)")
  await pick("Condition 1 operator", "<")
  fireEvent.change(await screen.findByLabelText("Condition 1 value"), { target: { value: "30" } })

  await waitFor(() => expect(screen.getByText(/^Valid$/)).toBeInTheDocument(), { timeout: 3000 })
  // Committed slots rest as readable tokens.
  expect(screen.getByRole("button", { name: /condition 1 variable: rsi/i })).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: /apply expression/i }))
  const createBtn = screen.getByRole("button", { name: /create signal/i })
  await waitFor(() => expect(createBtn).toBeEnabled())
  fireEvent.click(createBtn)
  await waitFor(() => expect(created).toHaveBeenCalled())
  expect(created.mock.calls[0][0].expression).toEqual({ "<": [{ var: "rsi_14" }, 30] })
})

// 12. Builder → JSON escape hatch reflects the built expression
it("shows the builder's expression when switching to JSON", async () => {
  renderSignals()
  await waitFor(() => screen.getByText("Momentum Pop"))
  fireEvent.click(screen.getByRole("button", { name: /new signal/i }))
  fireEvent.click(await screen.findByRole("button", { name: /build expression/i }))
  await pick("Condition 1 variable", "BB Squeeze")
  await pick("Condition 1 operator", "is true")
  fireEvent.click(screen.getByRole("button", { name: /^json$/i }))
  const textarea = await screen.findByLabelText(/expression json/i)
  expect(textarea.value).toContain("bb_squeeze")
})

// 13. Editing sends `type` (and never `expression`) in the PATCH body
it("submits type on edit and never the immutable expression", async () => {
  const patched = vi.fn()
  server.use(
    http.patch(`${API}/signal-rules/:id`, async ({ request, params }) => {
      patched(await request.json())
      const base = MOCK_SIGNAL_RULES.find((r) => r.id === params.id)
      return HttpResponse.json({ ...base })
    })
  )
  renderSignals()
  await waitFor(() => screen.getByText("Momentum Pop"))
  // Edit the custom "Momentum Pop" signal.
  fireEvent.click(screen.getByRole("button", { name: /edit momentum pop/i }))
  fireEvent.change(await screen.findByLabelText(/signal type/i), { target: { value: "trend" } })
  fireEvent.click(screen.getByRole("button", { name: /save changes/i }))
  await waitFor(() => expect(patched).toHaveBeenCalled())
  const body = patched.mock.calls[0][0]
  expect(body.type).toBe("trend")
  expect(body).not.toHaveProperty("expression")
})

// 14. Cancel in the expression editor restores the previous expression
it("discards expression edits on Cancel", async () => {
  renderSignals()
  await waitFor(() => screen.getByText("Momentum Pop"))
  fireEvent.click(screen.getByRole("button", { name: /new signal/i }))
  fireEvent.change(await screen.findByLabelText(/signal name/i), { target: { value: "Temp" } })
  fireEvent.click(screen.getByRole("button", { name: /build expression/i }))
  await pick("Condition 1 variable", "BB Squeeze")
  await pick("Condition 1 operator", "is true")
  fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }))

  // Back on the details view: still empty, name preserved, Create still disabled.
  expect(await screen.findByText(/no conditions yet/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/signal name/i)).toHaveValue("Temp")
  expect(screen.getByRole("button", { name: /create signal/i })).toBeDisabled()
})

// 15. Weight only accepts whole numbers; out-of-range shows red and blocks saving
it("filters weight keystrokes and flags an out-of-range weight inline", async () => {
  renderSignals()
  await waitFor(() => screen.getByText("Momentum Pop"))
  fireEvent.click(screen.getByRole("button", { name: /edit momentum pop/i }))
  const weight = await screen.findByLabelText("Signal weight")

  // A decimal can't even be entered.
  fireEvent.change(weight, { target: { value: "1.5" } })
  expect(weight).toHaveValue("2")

  fireEvent.change(weight, { target: { value: "0" } })
  expect(screen.getByText("Min 1")).toBeInTheDocument()
  expect(weight).toHaveAttribute("aria-invalid", "true")
  expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled()

  fireEvent.change(weight, { target: { value: "3" } })
  expect(screen.queryByText("Min 1")).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: /save changes/i })).toBeEnabled()
})

// 16. 422 messages name the real problem
it("maps server 422s to the actual field error", () => {
  const pyd = new Error('API 422: {"detail":[{"loc":["body","weight"],"msg":"Input should be a valid integer"}]}')
  expect(friendlyError(pyd)).toMatch(/weight: Input should be a valid integer/)
  const expr = new Error('API 422: {"detail":{"errors":["unknown variable: nope"]}}')
  expect(friendlyError(expr)).toMatch(/invalid expression.*unknown variable/i)
  expect(friendlyError(new Error("API 409: {}"))).toMatch(/already exists/)
  const removed = new Error('API 409: {"detail":"a signal named \'Momentum\' already exists (it was removed — restore it instead)"}')
  expect(friendlyError(removed)).toMatch(/^A signal named 'Momentum'.*restore it instead/)
})

// 17. Search + sort
it("filters by search and reorders by sort", async () => {
  renderSignals()
  await waitFor(() => screen.getByText("Momentum Pop"))

  fireEvent.change(screen.getByLabelText(/search signals/i), { target: { value: "momentum" } })
  expect(screen.getByText("Momentum Pop")).toBeInTheDocument()
  expect(screen.queryByText("Above EMA 50")).not.toBeInTheDocument()

  fireEvent.change(screen.getByLabelText(/search signals/i), { target: { value: "zzz-nothing" } })
  expect(screen.getByText(/no signals match/i)).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText(/search signals/i), { target: { value: "" } })
  await pick("Sort signals", "Weight (high→low)")
  // Momentum Pop is the only weight-2 rule, so it leads.
  const firstEdit = screen.getAllByRole("button", { name: /^edit /i })[0]
  expect(firstEdit).toHaveAccessibleName("Edit Momentum Pop")
})

async function openBuilder() {
  renderSignals()
  await waitFor(() => screen.getByText("Momentum Pop"))
  fireEvent.click(screen.getByRole("button", { name: /new signal/i }))
  fireEvent.click(await screen.findByRole("button", { name: /build expression/i }))
}

async function buildRsiBelow(n) {
  await pick("Condition 1 variable", "RSI(14)")
  await pick("Condition 1 operator", "<")
  fireEvent.change(await screen.findByLabelText("Condition 1 value"), { target: { value: String(n) } })
}

// 18. Unfinished rows block Apply instead of vanishing
it("blocks Apply while a condition is unfinished", async () => {
  await openBuilder()
  await buildRsiBelow(30)
  fireEvent.click(screen.getByRole("button", { name: /add condition/i }))
  await pick("Condition 2 variable", "MACD Histogram")
  await pick("Condition 2 operator", ">")

  expect(await screen.findByText(/condition 2 is incomplete/i)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /apply expression/i })).toBeDisabled()

  fireEvent.change(await screen.findByLabelText("Condition 2 value"), { target: { value: "0" } })
  await waitFor(() => expect(screen.getByRole("button", { name: /apply expression/i })).toBeEnabled())
})

// 19. Escape does not throw away edits
it("keeps edits when Escape is pressed in the editor", async () => {
  await openBuilder()
  await buildRsiBelow(30)
  fireEvent.keyDown(screen.getByLabelText("Condition 1 value"), { key: "Enter" })
  // Escape from a non-control element with unsaved changes: stays in the editor.
  fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" })
  expect(screen.getByRole("button", { name: /apply expression/i })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /condition 1 compare to: 30/i })).toBeInTheDocument()
})

// 20. Focus returns to the pill after Enter
it("returns focus to the pill when its control closes", async () => {
  await openBuilder()
  await buildRsiBelow(30)
  fireEvent.keyDown(screen.getByLabelText("Condition 1 value"), { key: "Enter" })
  const pill = await screen.findByRole("button", { name: /condition 1 compare to: 30/i })
  await waitFor(() => expect(pill).toHaveFocus())
})

// 21. Universe result is tied to the expression it was computed for
it("hides a universe result once the expression changes", async () => {
  await openBuilder()
  await buildRsiBelow(30)
  const run = screen.getByRole("button", { name: /preview across universe/i })
  await waitFor(() => expect(run).toBeEnabled(), { timeout: 3000 })
  fireEvent.click(run)
  expect(await screen.findByText(/matches/i)).toBeInTheDocument()

  fireEvent.keyDown(screen.getByLabelText("Condition 1 value"), { key: "Enter" })
  fireEvent.click(await screen.findByRole("button", { name: /condition 1 compare to: 30/i }))
  fireEvent.change(await screen.findByLabelText("Condition 1 value"), { target: { value: "70" } })
  await waitFor(() => expect(screen.queryByText(/^Matches/)).not.toBeInTheDocument())
})
