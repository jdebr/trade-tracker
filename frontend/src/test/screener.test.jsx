/**
 * Milestone 8 screener tests — background job + polling.
 *
 * Criteria:
 * 1.  "Run Screener" button is present and clickable
 * 2.  Clicking Run calls POST /screener/run and gets a job_id
 * 3.  While running, a progress message is shown
 * 4.  While running, the Run button is disabled
 * 5.  The frontend polls GET /screener/job/{id} until status is "done"
 * 6.  On job done, GET /screener/results is refetched and results render
 * 7.  Run metadata (pass1_count, pass2_count) appears after job completes
 * 8.  On job error status, an error alert is shown and button re-enables
 * 9.  If POST /screener/run itself fails, an error alert is shown
 * 10. Results table renders rows from GET /screener/results
 * 11. Score badge renders correct value per row
 * 12. Signal indicators render correctly
 * 13. Loading skeleton shown while initial results fetch is in flight
 * 14. Empty state shown when no results exist (404)
 */

import { it, expect, vi } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "./msw-server"
import { MOCK_SCREENER_RESULTS, MOCK_JOB_ID, MOCK_JOB_DONE } from "./handlers"
import ScreenerPage from "../pages/ScreenerPage"

function renderScreener() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ScreenerPage /></MemoryRouter>
    </QueryClientProvider>
  )
}

// 1. Run button present
it("renders Run Screener button", () => {
  renderScreener()
  expect(screen.getByRole("button", { name: /run screener/i })).toBeInTheDocument()
})

// 2. POST /screener/run called on click → receives job_id
it("clicking Run Screener calls POST /screener/run", async () => {
  const handler = vi.fn()
  server.use(
    http.post("http://localhost:8000/screener/run", () => {
      handler()
      return HttpResponse.json({ job_id: MOCK_JOB_ID, status: "pending" }, { status: 202 })
    })
  )
  renderScreener()
  fireEvent.click(screen.getByRole("button", { name: /run screener/i }))
  await waitFor(() => expect(handler).toHaveBeenCalledOnce())
})

// 3. Progress message shown while job is running
it("shows progress message while screener job is running", async () => {
  server.use(
    http.get("http://localhost:8000/screener/job/:jobId", () =>
      HttpResponse.json({ job_id: MOCK_JOB_ID, status: "running", result: null, error: null })
    )
  )
  renderScreener()
  fireEvent.click(screen.getByRole("button", { name: /run screener/i }))
  await waitFor(() =>
    expect(screen.getByRole("status")).toBeInTheDocument()
  )
})

// 4. Run button disabled while job is in flight (button text changes to "Running…")
it("Run Screener button is disabled while job is running", async () => {
  server.use(
    http.get("http://localhost:8000/screener/job/:jobId", () =>
      HttpResponse.json({ job_id: MOCK_JOB_ID, status: "running", result: null, error: null })
    )
  )
  renderScreener()
  fireEvent.click(screen.getByRole("button", { name: /run screener/i }))
  // Button text cycles: "Run Screener" → "Starting…" → "Running…" (all disabled)
  await waitFor(() => {
    const btn = screen.getByRole("button", { name: /starting|running/i })
    expect(btn).toBeDisabled()
  })
})

// 5 & 6. Polls until done, then results render
it("polls job endpoint until done and then refreshes results", async () => {
  let pollCount = 0
  server.use(
    http.get("http://localhost:8000/screener/job/:jobId", () => {
      pollCount++
      if (pollCount < 2) {
        return HttpResponse.json({ job_id: MOCK_JOB_ID, status: "running", result: null, error: null })
      }
      return HttpResponse.json(MOCK_JOB_DONE)
    })
  )
  renderScreener()
  fireEvent.click(screen.getByRole("button", { name: /run screener/i }))
  // Results should eventually appear (query invalidated after job done)
  await waitFor(
    () => expect(screen.getAllByRole("row").length).toBeGreaterThan(1),
    { timeout: 8000 }
  )
})

// 7. Run metadata shown after completion
it("shows pass count metadata after job completes", async () => {
  renderScreener()
  fireEvent.click(screen.getByRole("button", { name: /run screener/i }))
  await waitFor(() =>
    expect(screen.getByText(/pass 1:/i)).toBeInTheDocument()
  )
  expect(screen.getByText(/pass 2:/i)).toBeInTheDocument()
})

// 8. Job error → alert shown, button re-enables
it("shows error alert when screener job reports an error", async () => {
  server.use(
    http.get("http://localhost:8000/screener/job/:jobId", () =>
      HttpResponse.json({
        job_id: MOCK_JOB_ID, status: "error",
        result: null, error: "DB connection failed",
      })
    )
  )
  renderScreener()
  fireEvent.click(screen.getByRole("button", { name: /run screener/i }))
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument())
  expect(screen.getByRole("alert").textContent).toMatch(/screener failed/i)
  expect(screen.getByRole("button", { name: /run screener/i })).not.toBeDisabled()
})

// 9. POST /screener/run itself fails
it("shows error alert when POST /screener/run fails", async () => {
  server.use(
    http.post("http://localhost:8000/screener/run", () =>
      HttpResponse.json({ detail: "Server error" }, { status: 500 })
    )
  )
  renderScreener()
  fireEvent.click(screen.getByRole("button", { name: /run screener/i }))
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument())
  expect(screen.getByRole("alert").textContent).toMatch(/failed to start/i)
})

// 10. Results table rows render
it("renders a row for each result from GET /screener/results", async () => {
  renderScreener()
  await waitFor(() =>
    expect(screen.getAllByRole("row")).toHaveLength(MOCK_SCREENER_RESULTS.length + 1)
  )
})

// 11. Score badge renders correct value
it("renders correct score badge for each row", async () => {
  renderScreener()
  await waitFor(() => screen.getAllByRole("row"))
  for (const row of MOCK_SCREENER_RESULTS) {
    expect(screen.getAllByText(`${row.signal_score}/4`).length).toBeGreaterThanOrEqual(1)
  }
})

// 12. Signal dots have correct aria-labels
it("renders signal indicators for the top result", async () => {
  renderScreener()
  await waitFor(() => screen.getAllByRole("row"))
  expect(screen.getAllByLabelText(/bb squeeze true/i).length).toBeGreaterThan(0)
  expect(screen.getAllByLabelText(/rsi range true/i).length).toBeGreaterThan(0)
})

// 13. Loading skeleton
it("shows loading skeleton while results are loading", () => {
  server.use(
    http.get("http://localhost:8000/screener/results", () => new Promise(() => {}))
  )
  renderScreener()
  expect(screen.getByLabelText(/loading results/i)).toBeInTheDocument()
})

// 14. Empty/error state on 404
it("shows empty state with Run Screener guidance when GET /screener/results returns 404", async () => {
  server.use(
    http.get("http://localhost:8000/screener/results", () =>
      HttpResponse.json({ detail: "No screener results found" }, { status: 404 })
    )
  )
  renderScreener()
  await waitFor(() =>
    expect(screen.getByRole("alert")).toBeInTheDocument()
  )
  expect(screen.getByRole("alert").textContent).toMatch(/run screener/i)
})
