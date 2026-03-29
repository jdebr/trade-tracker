import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom"
import { Button } from "@/components/ui/button"

function ScreenerPage() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Screener</h1>
      <Button>Run Screener</Button>
    </main>
  )
}

function WatchlistPage() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Watchlist</h1>
      <p className="text-muted-foreground">Your watchlist will appear here.</p>
    </main>
  )
}

function NotFoundPage() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">404 — Page not found</h1>
    </main>
  )
}

const NAV_LINKS = [
  { to: "/",         label: "Screener" },
  { to: "/watchlist", label: "Watchlist" },
]

function Nav() {
  return (
    <nav className="flex gap-4 px-6 py-3 border-b border-border bg-card">
      <span className="font-bold text-primary mr-4">SwingTrader</span>
      {NAV_LINKS.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            isActive
              ? "text-sm font-medium text-primary"
              : "text-sm font-medium text-muted-foreground hover:text-foreground"
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-background text-foreground">
        <Nav />
        <Routes>
          <Route path="/"          element={<ScreenerPage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="*"          element={<NotFoundPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
