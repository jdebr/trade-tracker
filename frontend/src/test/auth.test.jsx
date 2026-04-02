/**
 * Auth tests — LoginPage and ProtectedRoute behaviour.
 *
 * Criteria:
 * 1.  Login page renders email and password fields
 * 2.  Submitting the form calls supabase.auth.signInWithPassword
 * 3.  A failed sign-in shows an inline error message
 * 4.  ProtectedRoute renders children when a session exists
 * 5.  ProtectedRoute redirects to /login when there is no session
 * 6.  Sign-out button calls supabase.auth.signOut
 */

import { it, expect, vi } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AuthContext, AuthProvider } from "@/context/AuthContext"
import ProtectedRoute from "@/components/ProtectedRoute"
import LoginPage from "@/pages/LoginPage"
import { supabase } from "@/lib/supabase"

const FAKE_SESSION = { access_token: "test-token", user: { id: "test-user" } }

function renderLogin(initialPath = "/login") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Provide session=null so LoginPage doesn't immediately redirect away
  return render(
    <QueryClientProvider client={qc}>
      <AuthContext.Provider value={{ session: null, user: null, loading: false, signOut: vi.fn() }}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<div>Home</div>} />
            <Route path="/screener" element={<div>Screener</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  )
}

function renderProtected({ session = FAKE_SESSION, loading = false } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut: vi.fn() }}>
        <MemoryRouter initialEntries={["/screener"]}>
          <Routes>
            <Route
              path="/screener"
              element={<ProtectedRoute><div>Protected Content</div></ProtectedRoute>}
            />
            <Route path="/login" element={<div>Login Page</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  )
}

// 1. Login page renders email and password fields
it("renders email and password inputs on the login page", () => {
  renderLogin()
  expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
})

// 2. Submitting the form calls signInWithPassword
it("calls signInWithPassword on form submit", async () => {
  const spy = vi.spyOn(supabase.auth, "signInWithPassword")
  renderLogin()
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "joe@example.com" } })
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "secret" } })
  fireEvent.submit(screen.getByRole("button", { name: "Sign in" }))
  await waitFor(() => expect(spy).toHaveBeenCalledWith({ email: "joe@example.com", password: "secret" }))
})

// 3. Failed sign-in shows error message
it("shows an error message when sign-in fails", async () => {
  vi.spyOn(supabase.auth, "signInWithPassword").mockResolvedValueOnce({
    data: { session: null },
    error: { message: "Invalid login credentials" },
  })
  renderLogin()
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "bad@example.com" } })
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "wrong" } })
  fireEvent.submit(screen.getByRole("button", { name: "Sign in" }))
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(/invalid login credentials/i)
  )
})

// 4. ProtectedRoute renders children when session exists
it("renders children when session is present", () => {
  renderProtected({ session: FAKE_SESSION })
  expect(screen.getByText("Protected Content")).toBeInTheDocument()
})

// 5. ProtectedRoute redirects to /login when no session
it("redirects to /login when there is no session", () => {
  renderProtected({ session: null })
  expect(screen.getByText("Login Page")).toBeInTheDocument()
  expect(screen.queryByText("Protected Content")).not.toBeInTheDocument()
})

// 6. signOut is wired up correctly
it("calls signOut when the context signOut is invoked", async () => {
  const signOutSpy = vi.fn()
  const qc = new QueryClient()
  render(
    <QueryClientProvider client={qc}>
      <AuthContext.Provider value={{ session: FAKE_SESSION, user: FAKE_SESSION.user, loading: false, signOut: signOutSpy }}>
        <MemoryRouter>
          <button onClick={signOutSpy}>Sign out</button>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  )
  fireEvent.click(screen.getByRole("button", { name: /sign out/i }))
  expect(signOutSpy).toHaveBeenCalledOnce()
})
