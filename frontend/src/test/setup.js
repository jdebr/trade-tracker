import "@testing-library/jest-dom"
import { afterAll, afterEach, beforeAll, vi } from "vitest"
import { server } from "./msw-server"

// Mock the Supabase client so all tests run as an authenticated user
// without needing real credentials. MSW handles all API responses, so
// the token value doesn't matter — it just needs to be non-null.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: "test-token", user: { id: "test-user" } } },
        }),
      onAuthStateChange: (cb) => {
        cb("SIGNED_IN", { access_token: "test-token", user: { id: "test-user" } })
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signOut: () => Promise.resolve({ error: null }),
      signInWithPassword: () =>
        Promise.resolve({ data: { session: { access_token: "test-token" } }, error: null }),
      signInWithOAuth: () => Promise.resolve({ error: null }),
    },
  },
}))

// jsdom doesn't implement ResizeObserver — provide a no-op stub
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
