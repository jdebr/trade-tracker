import { NavLink } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { BarChart2, ScanSearch, LineChart, Bell, BookMarked } from "lucide-react"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { to: "/screener",  label: "Screener",  Icon: ScanSearch },
  { to: "/scanner",   label: "Scanner",   Icon: BarChart2  },
  { to: "/watchlist", label: "Watchlist", Icon: BookMarked },
  { to: "/chart",     label: "Chart",     Icon: LineChart  },
  { to: "/alerts",    label: "Alerts",    Icon: Bell, showBadge: true },
]

export default function BottomNav() {
  const { data: alerts = [] } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => api.get("/alerts"),
    staleTime: 60_000,
  })
  const unreadCount = alerts.length

  return (
    <nav
      aria-label="Mobile navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex border-t border-border bg-card"
    >
      {NAV_ITEMS.map(({ to, label, Icon, showBadge }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              "flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium transition-colors",
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )
          }
        >
          <span className="relative">
            <Icon size={20} aria-hidden="true" />
            {showBadge && unreadCount > 0 && (
              <span
                aria-label={`${unreadCount} unread alerts`}
                className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center px-0.5"
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </span>
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
