import { useState, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip } from "@/components/ui/Tooltip"
import { INDICATORS } from "@/lib/indicators"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

function rsiColour(rsi) {
  if (rsi == null) return "text-muted-foreground"
  if (rsi >= 70)   return "text-red-500 dark:text-red-400"
  if (rsi <= 30)   return "text-blue-500 dark:text-blue-400"
  if (rsi >= 35 && rsi <= 65) return "text-green-600 dark:text-green-400"
  return "text-muted-foreground"
}

function macdColour(hist) {
  if (hist == null) return "text-muted-foreground"
  return hist > 0
    ? "text-green-600 dark:text-green-400"
    : "text-red-500 dark:text-red-400"
}

function BoolDot({ value }) {
  if (value == null) return <span className="text-muted-foreground">—</span>
  return (
    <span
      className={cn(
        "inline-block w-2.5 h-2.5 rounded-full",
        value ? "bg-green-500" : "bg-muted-foreground/30"
      )}
      aria-label={value ? "true" : "false"}
    />
  )
}

function fmt(n, decimals = 2) {
  return n != null ? Number(n).toFixed(decimals) : "—"
}

function fmtDatetime(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  })
}

// Indicator header tooltip text
function indicatorTip(key) {
  const ind = INDICATORS[key]
  if (!ind) return null
  return `${ind.description} ${ind.interpretation}`
}

// ---------------------------------------------------------------------------
// Scheduler status bar
// ---------------------------------------------------------------------------

function SchedulerStatusBar({ onRunNow, isRunning, scanError }) {
  const { data: status } = useQuery({
    queryKey: ["scheduler-status"],
    queryFn: () => api.get("/scheduler/status"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const lastRun  = status?.last_run_at ? fmtDatetime(status.last_run_at) : "Never"
  const nextRun  = status?.next_run_time ? fmtDatetime(status.next_run_time) : "—"
  const paused   = status?.paused
  const cooldown = status?.seconds_until_cooldown_expires

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-5 px-3 py-2.5 rounded-lg border border-border bg-muted/30 text-xs text-muted-foreground">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span>Last scan: <strong className="text-foreground">{lastRun}</strong></span>
        {!paused && <span>Next scan: <strong className="text-foreground">{nextRun}</strong></span>}
        {paused && (
          <span className="text-amber-600 dark:text-amber-400 font-medium">
            Scheduler paused until {fmtDatetime(status.pause_until)}
          </span>
        )}
        {status?.td_api_usage && (
          <span>
            API credits:{" "}
            <strong className="text-foreground">
              {status.td_api_usage.current_usage}/{status.td_api_usage.plan_limit}
            </strong>{" "}
            today
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {scanError && (
          <span role="alert" className="text-destructive">{scanError}</span>
        )}
        {cooldown != null && !isRunning && (
          <span className="text-muted-foreground">
            Cooldown: {Math.ceil(cooldown / 60)}m remaining
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onRunNow}
          disabled={isRunning || cooldown != null}
          aria-label="Run scan now"
        >
          <RefreshCw size={13} className={cn("mr-1.5", isRunning && "animate-spin")} aria-hidden="true" />
          {isRunning ? "Scanning…" : "Run Scan Now"}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Table (desktop)
// ---------------------------------------------------------------------------

function ScannerTable({ rows, nameMap }) {
  return (
    <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-muted-foreground">
            <th className="px-4 py-3 text-left font-medium">Symbol</th>
            <Tooltip content={indicatorTip("rsi_14")}>
              <th className="px-4 py-3 text-right font-medium cursor-help">RSI</th>
            </Tooltip>
            <Tooltip content={indicatorTip("bb_squeeze")}>
              <th className="px-4 py-3 text-center font-medium cursor-help">BB Squeeze</th>
            </Tooltip>
            <Tooltip content={indicatorTip("macd_hist")}>
              <th className="px-4 py-3 text-right font-medium cursor-help">MACD Hist</th>
            </Tooltip>
            <Tooltip content={indicatorTip("ema_50")}>
              <th className="px-4 py-3 text-right font-medium cursor-help">EMA 50</th>
            </Tooltip>
            <Tooltip content={indicatorTip("atr_14")}>
              <th className="px-4 py-3 text-right font-medium cursor-help">ATR</th>
            </Tooltip>
            <th className="px-4 py-3 text-right font-medium">Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.symbol}
              className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
            >
              <td className="px-4 py-3 font-semibold tracking-wide">
                <Tooltip content={nameMap.get(row.symbol)}>
                  <span className="cursor-default">{row.symbol}</span>
                </Tooltip>
              </td>
              <td className={cn("px-4 py-3 text-right tabular-nums font-medium", rsiColour(row.rsi_14))}>
                {fmt(row.rsi_14, 1)}
              </td>
              <td className="px-4 py-3 text-center">
                <BoolDot value={row.bb_squeeze} />
              </td>
              <td className={cn("px-4 py-3 text-right tabular-nums", macdColour(row.macd_hist))}>
                {fmt(row.macd_hist)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                {fmt(row.ema_50, 2)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                {fmt(row.atr_14, 2)}
              </td>
              <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                {row.date ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Card list (mobile)
// ---------------------------------------------------------------------------

function ScannerCards({ rows, nameMap }) {
  return (
    <div className="md:hidden space-y-3">
      {rows.map((row) => (
        <div
          key={row.symbol}
          className="rounded-lg border border-border bg-card p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <Tooltip content={nameMap.get(row.symbol)}>
              <span className="font-semibold tracking-wide cursor-default">{row.symbol}</span>
            </Tooltip>
            <span className="text-xs text-muted-foreground">{row.date ?? "—"}</span>
          </div>
          <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">RSI</span>
              <span className={cn("tabular-nums font-medium", rsiColour(row.rsi_14))}>
                {fmt(row.rsi_14, 1)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">BB Squeeze</span>
              <BoolDot value={row.bb_squeeze} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">MACD Hist</span>
              <span className={cn("tabular-nums", macdColour(row.macd_hist))}>
                {fmt(row.macd_hist)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">ATR</span>
              <span className="tabular-nums text-muted-foreground">{fmt(row.atr_14)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function ScannerSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading scanner">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ScannerPage() {
  const queryClient = useQueryClient()
  const [scanError, setScanError] = useState(null)

  const { data: watchlist = [], isLoading: loadingWatchlist } = useQuery({
    queryKey: ["watchlist"],
    queryFn: () => api.get("/watchlist"),
  })

  const { data: tickerList = [] } = useQuery({
    queryKey: ["tickers"],
    queryFn: () => api.get("/tickers"),
    staleTime: 60 * 60 * 1000,
  })

  const nameMap = useMemo(() => {
    const m = new Map()
    for (const t of tickerList) m.set(t.symbol, t.name)
    return m
  }, [tickerList])

  const symbols = watchlist.map((e) => e.symbol)

  const {
    data: snapshots = [],
    isLoading: loadingSnapshots,
    isError: snapshotsError,
    refetch: refetchSnapshots,
  } = useQuery({
    queryKey: ["snapshots", symbols],
    queryFn: () => api.get(`/indicators/snapshots?symbols=${symbols.join(",")}`),
    enabled: symbols.length > 0,
  })

  const { mutate: runScan, isPending: isRunning } = useMutation({
    mutationFn: () => api.post("/scheduler/trigger"),
    onSuccess: () => {
      setScanError(null)
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["snapshots"] })
        queryClient.invalidateQueries({ queryKey: ["scheduler-status"] })
      }, 3000)
    },
    onError: (err) => {
      const msg = err.message.includes("429")
        ? err.message.replace(/^API 429: /, "").replace(/^"(.*)"$/, "$1")
        : "Failed to trigger scan. Check that the server is running."
      setScanError(msg)
    },
  })

  const isLoading = loadingWatchlist || loadingSnapshots

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Scanner</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Live indicator status for your watchlist
        </p>
      </div>

      <SchedulerStatusBar
        onRunNow={() => runScan()}
        isRunning={isRunning}
        scanError={scanError}
      />

      {isLoading && <ScannerSkeleton />}

      {!isLoading && watchlist.length === 0 && (
        <div className="rounded-lg border border-border bg-muted/50 px-4 py-10 text-center text-muted-foreground text-sm">
          Add tickers to your watchlist to see scanner data.
        </div>
      )}

      {!isLoading && watchlist.length > 0 && snapshotsError && (
        <div className="space-y-3">
          <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Failed to load indicator snapshots.
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchSnapshots()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && snapshots.length === 0 && watchlist.length > 0 && !snapshotsError && (
        <div className="rounded-lg border border-border bg-muted/50 px-4 py-10 text-center text-muted-foreground text-sm">
          No indicator snapshots found.{" "}
          Use <strong>Run Scan Now</strong> above or wait for the scheduled 4 PM ET scan.
        </div>
      )}

      {!isLoading && snapshots.length > 0 && (
        <>
          <ScannerTable rows={snapshots} nameMap={nameMap} />
          <ScannerCards rows={snapshots} nameMap={nameMap} />
        </>
      )}
    </div>
  )
}
