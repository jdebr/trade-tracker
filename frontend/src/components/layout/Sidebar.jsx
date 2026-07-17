import { NavLink } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { NAV_ITEMS, BADGE_STYLES } from "@/lib/nav"
import { cn } from "@/lib/utils"

export default function Sidebar() {
  const { data: alerts = [] } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => api.get("/alerts"),
    staleTime: 60_000,
  })
  const { data: openPositions = [] } = useQuery({
    queryKey: ["positions", "open"],
    queryFn: () => api.get("/positions?status=open"),
    staleTime: 60_000,
  })

  const counts = { alerts: alerts.length, positions: openPositions.length }

  return (
    <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-border bg-card min-h-screen">
      <div className="px-5 py-4 border-b border-border">
        <span className="text-lg font-bold text-primary tracking-tight">SwingTrader</span>
      </div>

      <nav aria-label="Main navigation" className="flex flex-col gap-1 p-3 flex-1">
        {NAV_ITEMS.map(({ to, label, Icon, badge }) => {
          const count = badge ? counts[badge] : 0
          return (
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
              <span className="relative">
                <Icon size={16} aria-hidden="true" />
                {badge && count > 0 && (
                  <span
                    aria-label={`${count} ${badge === "alerts" ? "unread alerts" : "open positions"}`}
                    className={cn(
                      "absolute -top-1 -right-1.5 min-w-[14px] h-[14px] rounded-full text-[9px] font-bold flex items-center justify-center px-0.5",
                      BADGE_STYLES[badge]
                    )}
                  >
                    {count > 9 ? "9+" : count}
                  </span>
                )}
              </span>
              {label}
            </NavLink>
          )
        })}
      </nav>
    </aside>
  )
}
