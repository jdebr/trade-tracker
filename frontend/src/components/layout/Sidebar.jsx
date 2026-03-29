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
  { to: "/screener",  label: "Screener",  Icon: ScanSearch  },
  { to: "/scanner",   label: "Scanner",   Icon: BarChart2   },
  { to: "/watchlist", label: "Watchlist", Icon: BookMarked  },
  { to: "/chart",     label: "Chart",     Icon: LineChart   },
  { to: "/alerts",    label: "Alerts",    Icon: Bell        },
]

export default function Sidebar() {
  return (
    <aside
      className="hidden md:flex flex-col w-56 shrink-0 border-r border-border bg-card min-h-screen"
    >
      {/* Logo / brand */}
      <div className="px-5 py-4 border-b border-border">
        <span className="text-lg font-bold text-primary tracking-tight">
          SwingTrader
        </span>
      </div>

      <nav aria-label="Main navigation" className="flex flex-col gap-1 p-3 flex-1">
        {NAV_ITEMS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )
            }
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
