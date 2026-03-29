/**
 * Milestone 6b layout tests.
 *
 * Criteria:
 * 1. Layout shell renders without crashing
 * 2. Sidebar nav landmark is present in the DOM
 * 3. Bottom nav landmark is present in the DOM
 * 4. All 5 routes render their placeholder headings
 * 5. Active route link receives active styling (text-primary class)
 * 6. Layout has accessible nav landmarks with aria-labels
 */

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import Layout from "../components/layout/Layout"
import ScreenerPage  from "../pages/ScreenerPage"
import WatchlistPage from "../pages/WatchlistPage"
import ScannerPage   from "../pages/ScannerPage"
import ChartPage     from "../pages/ChartPage"
import AlertsPage    from "../pages/AlertsPage"

function renderAt(path) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/screener"  element={<ScreenerPage />}  />
            <Route path="/scanner"   element={<ScannerPage />}   />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/chart"     element={<ChartPage />}     />
            <Route path="/alerts"    element={<AlertsPage />}    />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

// 1. Layout renders without crashing
it("Layout shell renders without crashing", () => {
  renderAt("/screener")
  expect(document.body).toBeTruthy()
})

// 2 & 6. Sidebar nav landmark with aria-label
it("Sidebar has accessible nav landmark", () => {
  renderAt("/screener")
  expect(
    screen.getByRole("navigation", { name: /main navigation/i })
  ).toBeInTheDocument()
})

// 3 & 6. Bottom nav landmark with aria-label
it("BottomNav has accessible nav landmark", () => {
  renderAt("/screener")
  expect(
    screen.getByRole("navigation", { name: /mobile navigation/i })
  ).toBeInTheDocument()
})

// 4. All 5 routes render correct headings
describe("page routes render correct headings", () => {
  const cases = [
    ["/screener",  /screener/i ],
    ["/scanner",   /scanner/i  ],
    ["/watchlist", /watchlist/i],
    ["/chart",     /chart/i    ],
    ["/alerts",    /alerts/i   ],
  ]

  cases.forEach(([path, pattern]) => {
    it(`renders heading for ${path}`, () => {
      renderAt(path)
      expect(screen.getByRole("heading", { name: pattern })).toBeInTheDocument()
    })
  })
})

// 5. Active NavLink gets text-primary class
it("active NavLink receives text-primary class", () => {
  renderAt("/screener")
  const navLinks = screen.getAllByRole("link", { name: /screener/i })
  // At least one NavLink (sidebar or bottom) should have the active class
  const hasActive = navLinks.some((el) => el.className.includes("text-primary"))
  expect(hasActive).toBe(true)
})
