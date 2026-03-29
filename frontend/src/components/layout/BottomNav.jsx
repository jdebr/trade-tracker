import { NavLink } from "react-router-dom"
import {
  BarChart2,
  ScanSearch,
  LineChart,
  Bell,
  BookMarked,
} from "lucide-react"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { to: "/screener",  label: "Screener",  Icon: ScanSearch },
  { to: "/scanner",   label: "Scanner",   Icon: BarChart2  },
  { to: "/watchlist", label: "Watchlist", Icon: BookMarked },
  { to: "/chart",     label: "Chart",     Icon: LineChart  },
  { to: "/alerts",    label: "Alerts",    Icon: Bell       },
]

export default function BottomNav() {
  return (
    <nav
      aria-label="Mobile navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex border-t border-border bg-card"
    >
      {NAV_ITEMS.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              "flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium transition-colors",
              isActive
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            )
          }
        >
          <Icon size={20} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
