import {
  ScanSearch, LineChart, Bell, BookMarked,
  Briefcase, TrendingUp, Settings, SlidersHorizontal,
} from "lucide-react"

/**
 * Navigation config, shared by Sidebar (desktop) and BottomNav (mobile).
 *
 * The bottom bar can't fit every page without the targets becoming too small to
 * tap, so mobile shows the subset you touch during a trading week; the rest stay
 * reachable from the sidebar (and by URL).
 *
 * `badge` names a live count to show on the item: "alerts" (unacknowledged) or
 * "positions" (open). The nav components resolve the number.
 */
export const NAV_ITEMS = [
  { to: "/screener",  label: "Screener",  Icon: ScanSearch, primary: true  },
  { to: "/watchlist", label: "Watchlist", Icon: BookMarked, primary: true  },
  { to: "/positions", label: "Positions", Icon: Briefcase,  primary: true, badge: "positions" },
  { to: "/chart",     label: "Chart",     Icon: LineChart,  primary: false },
  { to: "/alerts",    label: "Alerts",    Icon: Bell,       primary: true, badge: "alerts" },
  { to: "/reports",   label: "Reports",   Icon: TrendingUp, primary: true  },
  { to: "/signals",   label: "Signals",   Icon: SlidersHorizontal, primary: false },
  { to: "/settings",  label: "Settings",  Icon: Settings,   primary: false },
]

export const PRIMARY_NAV_ITEMS = NAV_ITEMS.filter((i) => i.primary)

// Badge colour by type: alerts are a call to action (red), open positions are
// neutral status (primary).
export const BADGE_STYLES = {
  alerts:    "bg-destructive text-destructive-foreground",
  positions: "bg-primary text-primary-foreground",
}
