import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCORE_VARIANTS = ["neutral", "neutral", "neutral", "bull", "bull"]
const SCORE_LABELS   = ["0", "1", "2", "3", "4"]

function ScoreBadge({ score }) {
  const variant = score >= 3 ? "bull" : score >= 1 ? "secondary" : "neutral"
  return (
    <Badge variant={variant} aria-label={`Signal score ${score}`}>
      {score}/4
    </Badge>
  )
}

function SignalDot({ value, label }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        value ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
      )}
      aria-label={`${label} ${value ? "true" : "false"}`}
    >
      <span
        className={cn(
          "w-2 h-2 rounded-full shrink-0",
          value ? "bg-green-500" : "bg-muted-foreground/40"
        )}
        aria-hidden="true"
      />
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function ResultsSkeleton() {
  return (
    <div className="space-y-2 mt-4" aria-label="Loading results">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Results table (desktop)
// ---------------------------------------------------------------------------

const SIGNALS = [
  { key: "bb_squeeze",       label: "BB Squeeze"  },
  { key: "rsi_in_range",     label: "RSI Range"   },
  { key: "above_ema50",      label: "Above EMA50" },
  { key: "volume_expansion", label: "Vol Expand"  },
]

function ResultsTable({ rows }) {
  return (
    <div className="hidden md:block overflow-x-auto rounded-lg border border-border mt-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-muted-foreground">
            <th className="px-4 py-3 text-left font-medium w-12">#</th>
            <th className="px-4 py-3 text-left font-medium">Symbol</th>
            <th className="px-4 py-3 text-left font-medium">Score</th>
            <th className="px-4 py-3 text-left font-medium">Close</th>
            {SIGNALS.map(({ key, label }) => (
              <th key={key} className="px-4 py-3 text-left font-medium">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.symbol}
              className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
            >
              <td className="px-4 py-3 text-muted-foreground">{row.rank}</td>
              <td className="px-4 py-3 font-semibold tracking-wide">{row.symbol}</td>
              <td className="px-4 py-3"><ScoreBadge score={row.signal_score} /></td>
              <td className="px-4 py-3 tabular-nums">
                {row.close_price != null ? `$${Number(row.close_price).toFixed(2)}` : "—"}
              </td>
              {SIGNALS.map(({ key }) => (
                <td key={key} className="px-4 py-3">
                  <SignalDot value={row[key]} label="" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Results card list (mobile)
// ---------------------------------------------------------------------------

function ResultsCards({ rows }) {
  return (
    <div className="md:hidden space-y-3 mt-4">
      {rows.map((row) => (
        <div
          key={row.symbol}
          className="rounded-lg border border-border bg-card p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-5">#{row.rank}</span>
              <span className="font-semibold tracking-wide">{row.symbol}</span>
            </div>
            <div className="flex items-center gap-2">
              {row.close_price != null && (
                <span className="text-sm tabular-nums text-muted-foreground">
                  ${Number(row.close_price).toFixed(2)}
                </span>
              )}
              <ScoreBadge score={row.signal_score} />
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {SIGNALS.map(({ key, label }) => (
              <SignalDot key={key} value={row[key]} label={label} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ScreenerPage() {
  const queryClient = useQueryClient()
  const [runError, setRunError] = useState(null)

  const { data: results, isLoading, isError } = useQuery({
    queryKey: ["screener-results"],
    queryFn: () => api.get("/screener/results"),
    retry: false,
  })

  const { mutate: runScreener, isPending: isRunning } = useMutation({
    mutationFn: () => api.post("/screener/run"),
    onSuccess: () => {
      setRunError(null)
      queryClient.invalidateQueries({ queryKey: ["screener-results"] })
    },
    onError: (err) => setRunError(err.message),
  })

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Screener</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Two-pass S&amp;P 500 signal scanner
          </p>
        </div>
        <Button
          onClick={() => runScreener()}
          disabled={isRunning}
          aria-label="Run screener"
        >
          {isRunning ? "Running…" : "Run Screener"}
        </Button>
      </div>

      {/* Run error */}
      {runError && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {runError}
        </div>
      )}

      {/* Results */}
      {isLoading && <ResultsSkeleton />}

      {isError && !isLoading && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-border bg-muted/50 px-4 py-8 text-center text-muted-foreground"
        >
          No screener results yet. Run the screener to generate results.
        </div>
      )}

      {results && results.length > 0 && (
        <>
          <ResultsTable rows={results} />
          <ResultsCards rows={results} />
        </>
      )}

      {results && results.length === 0 && (
        <div className="mt-4 rounded-lg border border-border bg-muted/50 px-4 py-8 text-center text-muted-foreground">
          No candidates found. Try running the screener again.
        </div>
      )}
    </div>
  )
}
