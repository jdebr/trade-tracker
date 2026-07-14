import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { CheckCheck, BellOff } from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { POSITION_ALERT_META } from "@/lib/exitMethods"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Alert type → human label + badge colour
//
// Opportunity alerts ("here's a trade idea") and position alerts ("a trade you
// hold hit its exit") share this table but mean very different things — the
// second kind usually wants action today.
// ---------------------------------------------------------------------------
const ALERT_TYPE_META = {
  // Opportunity — EOD scanner
  bb_squeeze:     { label: "BB Squeeze",      variant: "default"   },
  rsi_oversold:   { label: "RSI Oversold",    variant: "bull"      },
  rsi_overbought: { label: "RSI Overbought",  variant: "bear"      },
  macd_crossover: { label: "MACD Crossover",  variant: "secondary" },
  ema_crossover:  { label: "EMA Crossover",   variant: "secondary" },
  vol_expansion:  { label: "Vol Expansion",   variant: "neutral"   },
  // Opportunity — intraday poller
  price_below_lower_bb: { label: "Below Lower BB", variant: "bull"    },
  price_above_upper_bb: { label: "Above Upper BB", variant: "bear"    },
  price_below_ema8:     { label: "Below EMA 8",    variant: "neutral" },
  price_above_ema8:     { label: "Above EMA 8",    variant: "neutral" },
  // Position — from position_monitor
  ...Object.fromEntries(
    Object.entries(POSITION_ALERT_META).map(([k, m]) => [k, { label: m.label, variant: m.variant }])
  ),
}

const TABS = [
  { key: "all",         label: "All"         },
  { key: "position",    label: "Positions"   },
  { key: "opportunity", label: "Opportunities" },
]

function AlertTypeBadge({ type }) {
  const meta = ALERT_TYPE_META[type] ?? { label: type, variant: "outline" }
  return <Badge variant={meta.variant}>{meta.label}</Badge>
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  })
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit",
  })
}

// ---------------------------------------------------------------------------
// Single alert card
// ---------------------------------------------------------------------------
function AlertCard({ alert, onAcknowledge, isAcknowledging }) {
  const isPosition = alert.category === "position"
  const meta = POSITION_ALERT_META[alert.alert_type]

  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 px-4 py-4 border-b border-border last:border-0 hover:bg-muted/20 transition-colors",
        // Position alerts concern money already at risk — give them a visual
        // spine so they don't get lost in a wall of opportunity alerts.
        isPosition && "border-l-2 border-l-primary bg-primary/[0.03]"
      )}
    >
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold tracking-wide text-sm">{alert.symbol}</span>
          <AlertTypeBadge type={alert.alert_type} />
          {alert.details?.is_simulated && <Badge variant="secondary">SIM</Badge>}
          {alert.signal_score != null && (
            <Badge variant={alert.signal_score >= 3 ? "bull" : "secondary"}>
              {alert.signal_score}/4
            </Badge>
          )}
        </div>

        {meta && <p className="text-xs text-muted-foreground">{meta.description}</p>}

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {alert.price_at_trigger != null && (
            <span>
              Price: <span className="text-foreground tabular-nums font-medium">
                ${Number(alert.price_at_trigger).toFixed(2)}
              </span>
            </span>
          )}
          {alert.details?.unrealized_r != null && (
            <span>
              Unrealized:{" "}
              <span className={cn(
                "tabular-nums font-medium",
                alert.details.unrealized_r >= 0
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-500 dark:text-red-400"
              )}>
                {alert.details.unrealized_r >= 0 ? "+" : ""}
                {Number(alert.details.unrealized_r).toFixed(2)}R
              </span>
            </span>
          )}
          <span>{fmtDate(alert.triggered_at)} at {fmtTime(alert.triggered_at)}</span>
          {isPosition && (
            <Link to="/positions" className="text-primary hover:underline font-medium">
              View position
            </Link>
          )}
        </div>

        {alert.details && Object.keys(alert.details).length > 0 && (
          <div className="flex flex-wrap gap-2 mt-0.5">
            {Object.entries(alert.details)
              // Already surfaced above as first-class fields — don't repeat them
              // in the raw key/value chips.
              .filter(([k]) => !["is_simulated", "unrealized_r", "entry_price"].includes(k))
              .map(([k, v]) => (
                <span key={k} className="text-xs bg-muted rounded px-1.5 py-0.5 text-muted-foreground">
                  {k}: <span className={cn(
                    "font-medium",
                    v === true  ? "text-green-600 dark:text-green-400" :
                    v === false ? "text-muted-foreground" : "text-foreground"
                  )}>
                    {String(v)}
                  </span>
                </span>
              ))}
          </div>
        )}
      </div>

      <button
        onClick={() => onAcknowledge(alert.id)}
        disabled={isAcknowledging}
        aria-label={`Acknowledge alert for ${alert.symbol}`}
        className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors disabled:opacity-40 mt-0.5"
      >
        <CheckCheck size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function AlertsPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState("all")

  // The unfiltered query stays keyed as ["alerts"] — the nav badge count and the
  // acknowledge mutations both invalidate that key.
  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => api.get("/alerts"),
  })

  const visible = tab === "all" ? alerts : alerts.filter((a) => a.category === tab)
  const counts = {
    all:         alerts.length,
    position:    alerts.filter((a) => a.category === "position").length,
    opportunity: alerts.filter((a) => a.category === "opportunity").length,
  }

  const { mutate: acknowledge, isPending: isAcknowledging } = useMutation({
    mutationFn: (id) => api.patch(`/alerts/${id}/acknowledge`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts"] }),
  })

  const { mutate: acknowledgeAll, isPending: isAcknowledgingAll } = useMutation({
    mutationFn: () => api.post("/alerts/acknowledge-all"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts"] }),
  })

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Alerts</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Unacknowledged signal alerts
          </p>
        </div>
        {alerts.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => acknowledgeAll()}
            disabled={isAcknowledgingAll}
            aria-label="Clear all alerts"
          >
            <CheckCheck size={14} aria-hidden="true" />
            {isAcknowledgingAll ? "Clearing…" : "Clear All"}
          </Button>
        )}
      </div>

      {/* Category tabs */}
      {!isLoading && alerts.length > 0 && (
        <div role="tablist" aria-label="Filter alerts" className="flex gap-1.5 mb-4">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                tab === key
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {label}
              <span className="ml-1.5 text-muted-foreground/70">{counts[key]}</span>
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3" aria-label="Loading alerts">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && visible.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-muted/30 py-16 gap-3">
          <BellOff size={32} className="text-muted-foreground/50" aria-hidden="true" />
          <p className="text-muted-foreground text-sm">
            {alerts.length === 0
              ? "No unacknowledged alerts."
              : `No unacknowledged ${tab} alerts.`}
          </p>
        </div>
      )}

      {/* Alert list */}
      {!isLoading && visible.length > 0 && (
        <>
          <div className="rounded-lg border border-border bg-card">
            {visible.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onAcknowledge={acknowledge}
                isAcknowledging={isAcknowledging}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3 text-right">
            {visible.length} unacknowledged alert{visible.length !== 1 ? "s" : ""}
          </p>
        </>
      )}
    </div>
  )
}
