import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { CheckCheck, BellOff } from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Alert type → human label + badge colour
// ---------------------------------------------------------------------------
const ALERT_TYPE_META = {
  bb_squeeze:     { label: "BB Squeeze",      variant: "default"     },
  rsi_oversold:   { label: "RSI Oversold",    variant: "bull"        },
  rsi_overbought: { label: "RSI Overbought",  variant: "bear"        },
  macd_crossover: { label: "MACD Crossover",  variant: "secondary"   },
  ema_crossover:  { label: "EMA Crossover",   variant: "secondary"   },
  vol_expansion:  { label: "Vol Expansion",   variant: "neutral"     },
}

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
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-4 border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold tracking-wide text-sm">{alert.symbol}</span>
          <AlertTypeBadge type={alert.alert_type} />
          {alert.signal_score != null && (
            <Badge variant={alert.signal_score >= 3 ? "bull" : "secondary"}>
              {alert.signal_score}/4
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {alert.price_at_trigger != null && (
            <span>
              Price: <span className="text-foreground tabular-nums font-medium">
                ${Number(alert.price_at_trigger).toFixed(2)}
              </span>
            </span>
          )}
          <span>{fmtDate(alert.triggered_at)} at {fmtTime(alert.triggered_at)}</span>
        </div>

        {alert.details && Object.keys(alert.details).length > 0 && (
          <div className="flex flex-wrap gap-2 mt-0.5">
            {Object.entries(alert.details).map(([k, v]) => (
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

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => api.get("/alerts"),
  })

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

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3" aria-label="Loading alerts">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && alerts.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-muted/30 py-16 gap-3">
          <BellOff size={32} className="text-muted-foreground/50" aria-hidden="true" />
          <p className="text-muted-foreground text-sm">No unacknowledged alerts.</p>
        </div>
      )}

      {/* Alert list */}
      {!isLoading && alerts.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          {alerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onAcknowledge={acknowledge}
              isAcknowledging={isAcknowledging}
            />
          ))}
        </div>
      )}

      {!isLoading && alerts.length > 0 && (
        <p className="text-xs text-muted-foreground mt-3 text-right">
          {alerts.length} unacknowledged alert{alerts.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  )
}
