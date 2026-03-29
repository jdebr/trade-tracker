import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { Skeleton } from "@/components/ui/skeleton"
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

// ---------------------------------------------------------------------------
// Table (desktop)
// ---------------------------------------------------------------------------

function ScannerTable({ rows }) {
  return (
    <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-muted-foreground">
            <th className="px-4 py-3 text-left font-medium">Symbol</th>
            <th className="px-4 py-3 text-right font-medium">RSI</th>
            <th className="px-4 py-3 text-center font-medium">BB Squeeze</th>
            <th className="px-4 py-3 text-right font-medium">MACD Hist</th>
            <th className="px-4 py-3 text-right font-medium">EMA 50</th>
            <th className="px-4 py-3 text-right font-medium">ATR</th>
            <th className="px-4 py-3 text-right font-medium">Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.symbol}
              className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
            >
              <td className="px-4 py-3 font-semibold tracking-wide">{row.symbol}</td>
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

function ScannerCards({ rows }) {
  return (
    <div className="md:hidden space-y-3">
      {rows.map((row) => (
        <div
          key={row.symbol}
          className="rounded-lg border border-border bg-card p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold tracking-wide">{row.symbol}</span>
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
  const { data: watchlist = [], isLoading: loadingWatchlist } = useQuery({
    queryKey: ["watchlist"],
    queryFn: () => api.get("/watchlist"),
  })

  const symbols = watchlist.map((e) => e.symbol)

  const {
    data: snapshots = [],
    isLoading: loadingSnapshots,
    isError,
  } = useQuery({
    queryKey: ["snapshots", symbols],
    queryFn: () => api.get(`/indicators/snapshots?symbols=${symbols.join(",")}`),
    enabled: symbols.length > 0,
  })

  const isLoading = loadingWatchlist || loadingSnapshots

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Scanner</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Live indicator status for your watchlist
        </p>
      </div>

      {isLoading && <ScannerSkeleton />}

      {!isLoading && watchlist.length === 0 && (
        <div className="rounded-lg border border-border bg-muted/50 px-4 py-10 text-center text-muted-foreground text-sm">
          Add tickers to your watchlist to see scanner data.
        </div>
      )}

      {!isLoading && watchlist.length > 0 && isError && (
        <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Failed to load indicator snapshots.
        </div>
      )}

      {!isLoading && snapshots.length === 0 && watchlist.length > 0 && !isError && (
        <div className="rounded-lg border border-border bg-muted/50 px-4 py-10 text-center text-muted-foreground text-sm">
          No indicator snapshots found. Run <strong>Indicators → Compute</strong> first.
        </div>
      )}

      {!isLoading && snapshots.length > 0 && (
        <>
          <ScannerTable rows={snapshots} />
          <ScannerCards rows={snapshots} />
        </>
      )}
    </div>
  )
}
