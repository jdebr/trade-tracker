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
 */

import { it, expect, vi } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "./msw-server"
import { MOCK_SIGNAL_RULES } from "./handlers"
import SignalsPage from "../pages/SignalsPage"

const API = "http://localhost:8000"

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
  // Drop to the raw-JSON escape hatch and type the expression.
  fireEvent.click(screen.getByRole("button", { name: /^json$/i }))
  fireEvent.change(await screen.findByLabelText(/expression json/i), {
    target: { value: '{"<": [{"var": "rsi_14"}, 30]}' },
  })

  // Validation is debounced; wait for the "Valid" panel.
  await waitFor(() => expect(screen.getByText(/^Valid$/)).toBeInTheDocument(), { timeout: 3000 })
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
  expect(await screen.findByLabelText(/match combinator/i)).toBeInTheDocument()
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

  fireEvent.change(await screen.findByLabelText(/condition 1 variable/i), { target: { value: "rsi_14" } })
  fireEvent.change(screen.getByLabelText(/condition 1 operator/i), { target: { value: "<" } })
  fireEvent.change(screen.getByLabelText(/condition 1 value/i), { target: { value: "30" } })

  await waitFor(() => expect(screen.getByText(/^Valid$/)).toBeInTheDocument(), { timeout: 3000 })
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
  fireEvent.change(await screen.findByLabelText(/condition 1 variable/i), { target: { value: "bb_squeeze" } })
  fireEvent.change(screen.getByLabelText(/condition 1 operator/i), { target: { value: "is_true" } })
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
