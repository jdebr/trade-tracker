import {
  BarChart2, ScanSearch, LineChart, Bell, BookMarked,
  Briefcase, TrendingUp, Settings,
} from "lucide-react"

/**
 * Navigation config, shared by Sidebar (desktop) and BottomNav (mobile).
 *
 * The bottom bar can't fit every page without the targets becoming too small to
 * tap, so mobile shows the subset you touch during a trading week; the rest stay
 * reachable from the sidebar (and by URL).
 */
export const NAV_ITEMS = [
  { to: "/screener",  label: "Screener",  Icon: ScanSearch, primary: true  },
  { to: "/scanner",   label: "Scanner",   Icon: BarChart2,  primary: false },
  { to: "/watchlist", label: "Watchlist", Icon: BookMarked, primary: false },
  { to: "/positions", label: "Positions", Icon: Briefcase,  primary: true  },
  { to: "/chart",     label: "Chart",     Icon: LineChart,  primary: false },
  { to: "/alerts",    label: "Alerts",    Icon: Bell,       primary: true, showBadge: true },
  { to: "/reports",   label: "Reports",   Icon: TrendingUp, primary: true  },
  { to: "/settings",  label: "Settings",  Icon: Settings,   primary: false },
]

export const PRIMARY_NAV_ITEMS = NAV_ITEMS.filter((i) => i.primary)
