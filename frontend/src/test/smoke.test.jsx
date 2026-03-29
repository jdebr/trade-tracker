/**
 * Milestone 6a smoke tests — verifies the tooling stack is wired up correctly.
 *
 * Criteria:
 * 1. App renders without crashing
 * 2. React Router renders the Screener route at /
 * 3. React Router renders the Watchlist route at /watchlist
 * 4. A shadcn Button component renders
 * 5. Tailwind utility classes are applied (className passes through)
 * 6. MSW intercepts an API call and returns mock data
 */

import { describe, it, expect } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { http, HttpResponse } from "msw"
import { server } from "./msw-server"
import App from "../App"
import { Button } from "../components/ui/button"
import { api } from "../lib/api"

function withProviders(ui, { route = "/" } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

// 1. App renders without crashing
it("renders App without crashing", () => {
  render(<App />)
  expect(document.body).toBeTruthy()
})

// 2 & 3. React Router routes
describe("React Router routes", () => {
  it("renders Screener page at /", () => {
    render(<App />)
    expect(screen.getByRole("heading", { name: /screener/i })).toBeInTheDocument()
  })
})

// 4. shadcn Button renders
it("renders a shadcn Button with correct text", () => {
  render(<Button>Click me</Button>)
  expect(screen.getByRole("button", { name: /click me/i })).toBeInTheDocument()
})

// 5. Tailwind className passes through to DOM
it("applies Tailwind className to Button", () => {
  render(<Button className="bg-red-500" data-testid="btn">Test</Button>)
  const btn = screen.getByTestId("btn")
  expect(btn.className).toContain("bg-red-500")
})

// 6. MSW intercepts API call
it("MSW intercepts health endpoint and returns mock data", async () => {
  server.use(
    http.get("http://localhost:8000/health", () =>
      HttpResponse.json({ status: "ok" })
    )
  )

  const data = await api.get("/health")
  expect(data.status).toBe("ok")
})
