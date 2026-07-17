import { NavLink } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { PRIMARY_NAV_ITEMS as NAV_ITEMS, BADGE_STYLES } from "@/lib/nav"
import { cn } from "@/lib/utils"

export default function BottomNav() {
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
    <nav
      aria-label="Mobile navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex border-t border-border bg-card"
    >
      {NAV_ITEMS.map(({ to, label, Icon, badge }) => {
        const count = badge ? counts[badge] : 0
        return (
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
            <span>{label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
