import { Outlet } from "react-router-dom"
import Sidebar from "./Sidebar"
import BottomNav from "./BottomNav"

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />

      {/* Main content — offset on mobile for bottom nav, offset on desktop for sidebar */}
      <main className="flex-1 p-6 pb-24 md:pb-6 overflow-y-auto">
        <Outlet />
      </main>

      <BottomNav />
    </div>
  )
}
