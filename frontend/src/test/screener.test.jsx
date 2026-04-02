/**
 * Screener page tests — results display, Screen Tickers button, admin Refresh Data panel.
 *
 * Criteria:
 * 1.  Results table renders rows from GET /screener/results
 * 2.  Score badge renders correct value per row
 * 3.  Signal indicators render correctly
 * 4.  Loading skeleton shown while initial results fetch is in flight
 * 5.  Empty state shown when no results exist (results auto-run on Saturday)
 * 6.  Last run timestamp shown in header when results exist
 * 7.  Screen Tickers button is visible in the header on initial load
 * 8.  Clicking Screen Tickers calls POST /screener/run and shows progress message
 * 9.  Screen Tickers button is disabled while job is in flight
 * 10. Polls screener job until done and then refreshes results
 * 11. Run metadata (pass1_count, pass2_count) appears after screener job completes
 * 12. Admin toggle reveals the Refresh Data button (not visible by default)
 * 13. Clicking Refresh Data calls POST /screener/refresh-data and shows progress
 * 14. Refresh Data button is disabled while refresh is in flight
 * 15. Refresh metadata (attempted, fetched, failed) appears after refresh completes
 * 16. Error shown in admin panel when POST /screener/refresh-data fails
 */

import { it, expect, vi } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "./msw-server"
import {
  MOCK_SCREENER_RESULTS,
  MOCK_JOB_ID,
  MOCK_JOB_DONE,
  MOCK_REFRESH_JOB_DONE,
} from "./handlers"
import ScreenerPage from "../pages/ScreenerPage"

function renderScreener() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ScreenerPage /></MemoryRouter>
    </QueryClientProvider>
  )
}

/** Open the admin panel, which reveals the Refresh Data button. */
function openAdmin() {
  fireEvent.click(screen.getByRole("button", { name: /admin/i }))
}

// 1. Results table rows render
it("renders a row for each result from GET /screener/results", async () => {
  renderScreener()
  await waitFor(() =>
    expect(screen.getAllByRole("row")).toHaveLength(MOCK_SCREENER_RESULTS.length + 1)
  )
})

// 2. Score badge renders correct value
it("renders correct score badge for each row", async () => {
  renderScreener()
  await waitFor(() => screen.getAllByRole("row"))
  for (const row of MOCK_SCREENER_RESULTS) {
    expect(screen.getAllByText(`${row.signal_score}/4`).length).toBeGreaterThanOrEqual(1)
  }
})

// 3. Signal dots have correct aria-labels
it("renders signal indicators for the top result", async () => {
  renderScreener()
  await waitFor(() => screen.getAllByRole("row"))
  expect(screen.getAllByLabelText(/bb squeeze true/i).length).toBeGreaterThan(0)
  expect(screen.getAllByLabelText(/rsi range true/i).length).toBeGreaterThan(0)
})

// 4. Loading skeleton
it("shows loading skeleton while results are loading", () => {
  server.use(
    http.get("http://localhost:8000/screener/results", () => new Promise(() => {}))
  )
  renderScreener()
  expect(screen.getByLabelText(/loading results/i)).toBeInTheDocument()
})

// 5. Empty state — mentions Saturday auto-run
it("shows empty state when no results exist", async () => {
  server.use(
    http.get("http://localhost:8000/screener/results", () =>
      HttpResponse.json({ detail: "No screener results found" }, { status: 404 })
    )
  )
  renderScreener()
  await waitFor(() =>
    expect(screen.getByRole("status")).toBeInTheDocument()
  )
  expect(screen.getByRole("status").textContent).toMatch(/saturday/i)
})

// 6. Last run timestamp shown in header
it("shows last run timestamp in header when results exist", async () => {
  renderScreener()
  await waitFor(() => screen.getAllByRole("row"))
  expect(screen.getByText(/last run:/i)).toBeInTheDocument()
})

// 7. Screen Tickers button visible on initial load
it("shows Screen Tickers button in the header on initial load", () => {
  renderScreener()
  expect(screen.getByRole("button", { name: /screen tickers/i })).toBeInTheDocument()
})

// 8. Clicking Screen Tickers calls POST /screener/run and shows progress
it("clicking Screen Tickers calls POST /screener/run and shows progress", async () => {
  const handler = vi.fn()
  server.use(
    http.post("http://localhost:8000/screener/run", () => {
      handler()
      return HttpResponse.json({ job_id: MOCK_JOB_ID, status: "pending" }, { status: 202 })
    }),
    http.get("http://localhost:8000/screener/job/:jobId", () =>
      HttpResponse.json({ job_id: MOCK_JOB_ID, status: "running", result: null, error: null })
    )
  )
  renderScreener()
  fireEvent.click(screen.getByRole("button", { name: /screen tickers/i }))
  await waitFor(() => expect(handler).toHaveBeenCalledOnce())
  await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument())
})

// 9. Screen Tickers button disabled while job is running
it("Screen Tickers button is disabled while screener job is running", async () => {
  server.use(
    http.get("http://localhost:8000/screener/job/:jobId", () =>
      HttpResponse.json({ job_id: MOCK_JOB_ID, status: "running", result: null, error: null })
    )
  )
  renderScreener()
  fireEvent.click(screen.getByRole("button", { name: /screen tickers/i }))
  await waitFor(() => {
    const btn = screen.getByRole("button", { name: /starting|screening/i })
    expect(btn).toBeDisabled()
  })
})

// 10. Polls screener job until done, then results render
it("polls screener job until done and then refreshes results", async () => {
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
  fireEvent.click(screen.getByRole("button", { name: /screen tickers/i }))
  await waitFor(
    () => expect(screen.getAllByRole("row").length).toBeGreaterThan(1),
    { timeout: 8000 }
  )
})

// 11. Run metadata shown after screener job completes
it("shows pass count metadata after screener job completes", async () => {
  renderScreener()
  fireEvent.click(screen.getByRole("button", { name: /screen tickers/i }))
  await waitFor(() =>
    expect(screen.getByText(/pass 1:/i)).toBeInTheDocument()
  )
  expect(screen.getByText(/pass 2:/i)).toBeInTheDocument()
})

// 12. Admin toggle reveals Refresh Data button (not visible by default)
it("admin toggle reveals the Refresh Data button", async () => {
  renderScreener()
  expect(screen.queryByRole("button", { name: /refresh data/i })).not.toBeInTheDocument()
  openAdmin()
  expect(screen.getByRole("button", { name: /refresh data/i })).toBeInTheDocument()
})

// 13. Clicking Refresh Data calls POST /screener/refresh-data and shows progress
it("clicking Refresh Data calls POST /screener/refresh-data and shows progress", async () => {
  const handler = vi.fn()
  server.use(
    http.post("http://localhost:8000/screener/refresh-data", () => {
      handler()
      return HttpResponse.json({ job_id: MOCK_JOB_ID, status: "pending" }, { status: 202 })
    }),
    http.get("http://localhost:8000/screener/job/:jobId", () =>
      HttpResponse.json({ job_id: MOCK_JOB_ID, status: "running", result: null, error: null })
    )
  )
  renderScreener()
  openAdmin()
  fireEvent.click(screen.getByRole("button", { name: /refresh data/i }))
  await waitFor(() => expect(handler).toHaveBeenCalledOnce())
  await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument())
})

// 14. Refresh Data button disabled while refresh is in flight
it("Refresh Data button is disabled while refresh is running", async () => {
  server.use(
    http.get("http://localhost:8000/screener/job/:jobId", () =>
      HttpResponse.json({ job_id: MOCK_JOB_ID, status: "running", result: null, error: null })
    )
  )
  renderScreener()
  openAdmin()
  fireEvent.click(screen.getByRole("button", { name: /refresh data/i }))
  await waitFor(() => {
    const btn = screen.getByRole("button", { name: /starting|refreshing/i })
    expect(btn).toBeDisabled()
  })
})

// 15. Refresh metadata shown after refresh job completes
it("shows refresh metadata after data refresh completes", async () => {
  server.use(
    http.get("http://localhost:8000/screener/job/:jobId", () =>
      HttpResponse.json(MOCK_REFRESH_JOB_DONE)
    )
  )
  renderScreener()
  openAdmin()
  fireEvent.click(screen.getByRole("button", { name: /refresh data/i }))
  await waitFor(() =>
    expect(screen.getByText(/attempted:/i)).toBeInTheDocument()
  )
  expect(screen.getByText(/fetched:/i)).toBeInTheDocument()
})

// 16. Error shown when POST /screener/refresh-data fails
it("shows error in admin panel when POST /screener/refresh-data fails", async () => {
  server.use(
    http.post("http://localhost:8000/screener/refresh-data", () =>
      HttpResponse.json({ detail: "Server error" }, { status: 500 })
    )
  )
  renderScreener()
  openAdmin()
  fireEvent.click(screen.getByRole("button", { name: /refresh data/i }))
  await waitFor(() =>
    expect(screen.getByText(/failed to start/i)).toBeInTheDocument()
  )
})
