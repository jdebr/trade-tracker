import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { AuthProvider } from "@/context/AuthContext"
import ErrorBoundary from "@/components/ErrorBoundary"
import ProtectedRoute from "@/components/ProtectedRoute"
import Layout from "@/components/layout/Layout"
import LoginPage     from "@/pages/LoginPage"
import ScreenerPage  from "@/pages/ScreenerPage"
import WatchlistPage from "@/pages/WatchlistPage"
import ScannerPage   from "@/pages/ScannerPage"
import ChartPage     from "@/pages/ChartPage"
import AlertsPage    from "@/pages/AlertsPage"

function NotFoundPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">404 — Page not found</h1>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Navigate to="/screener" replace />} />
            <Route path="/screener"  element={<ScreenerPage />}  />
            <Route path="/scanner"   element={<ScannerPage />}   />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/chart"     element={<ChartPage />}     />
            <Route path="/alerts"    element={<AlertsPage />}    />
            <Route path="*"          element={<NotFoundPage />}  />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ErrorBoundary>
  )
}
