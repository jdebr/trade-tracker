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

function fmtRunAt(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  })
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
// Admin panel — hidden by default, for data refresh
// ---------------------------------------------------------------------------

function AdminPanel({
  onRefresh, isRefreshing, refreshError, refreshButtonLabel, refreshMeta,
  onRecompute, isRecomputing, recomputeError, recomputeButtonLabel, recomputeMeta,
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-6 text-right">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      >
        admin
      </button>
      {open && (
        <div className="mt-2 inline-flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onRecompute}
              disabled={isRecomputing || isRefreshing}
            >
              {recomputeButtonLabel}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onRefresh}
              disabled={isRefreshing || isRecomputing}
            >
              {refreshButtonLabel}
            </Button>
          </div>
          {recomputeError && (
            <p className="text-xs text-destructive max-w-xs text-right">{recomputeError}</p>
          )}
          {recomputeMeta && (
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {recomputeMeta.rows_upserted != null && <span>Upserted: {recomputeMeta.rows_upserted}</span>}
              {recomputeMeta.skipped?.length > 0   && <span>Skipped (low bars): {recomputeMeta.skipped.length}</span>}
              {recomputeMeta.failed?.length  > 0   && <span>Failed: {recomputeMeta.failed.length}</span>}
            </div>
          )}
          {refreshError && (
            <p className="text-xs text-destructive max-w-xs text-right">{refreshError}</p>
          )}
          {refreshMeta && (
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {refreshMeta.attempted    != null && <span>Attempted: {refreshMeta.attempted}</span>}
              {refreshMeta.fetched      != null && <span>Fetched: {refreshMeta.fetched}</span>}
              {refreshMeta.skipped_fresh != null && <span>Skipped (fresh): {refreshMeta.skipped_fresh}</span>}
              {refreshMeta.failed       != null && <span>Failed: {refreshMeta.failed}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ScreenerPage() {
  const queryClient = useQueryClient()

  // ---- Screener run state ----
  const [screenJobId,    setScreenJobId]    = useState(null)
  const [screenError,    setScreenError]    = useState(null)
  const [screenMeta,     setScreenMeta]     = useState(null)

  // ---- Data refresh state ----
  const [refreshJobId,   setRefreshJobId]   = useState(null)
  const [refreshError,   setRefreshError]   = useState(null)
  const [refreshMeta,    setRefreshMeta]    = useState(null)

  // ---- Recompute indicators state ----
  const [recomputeJobId,  setRecomputeJobId]  = useState(null)
  const [recomputeError,  setRecomputeError]  = useState(null)
  const [recomputeMeta,   setRecomputeMeta]   = useState(null)

  // ---- Existing results ----
  const { data: results, isLoading, isError } = useQuery({
    queryKey: ["screener-results"],
    queryFn: () => api.get("/screener/results"),
    retry: false,
  })

  // ---- Trigger screener run ----
  const { mutate: startScreen, isPending: isStartingScreen } = useMutation({
    mutationFn: () => api.post("/screener/run"),
    onSuccess: ({ job_id }) => {
      setScreenJobId(job_id)
      setScreenError(null)
      setScreenMeta(null)
    },
    onError: (err) => setScreenError(`Failed to start screener: ${err.message}`),
  })

  // ---- Trigger data refresh ----
  const { mutate: startRefresh, isPending: isStartingRefresh } = useMutation({
    mutationFn: () => api.post("/screener/refresh-data"),
    onSuccess: ({ job_id }) => {
      setRefreshJobId(job_id)
      setRefreshError(null)
      setRefreshMeta(null)
    },
    onError: (err) => setRefreshError(`Failed to start data refresh: ${err.message}`),
  })

  // ---- Trigger recompute all indicators ----
  const { mutate: startRecompute, isPending: isStartingRecompute } = useMutation({
    mutationFn: () => api.post("/indicators/compute?all_symbols=true"),
    onSuccess: ({ job_id }) => {
      setRecomputeJobId(job_id)
      setRecomputeError(null)
      setRecomputeMeta(null)
    },
    onError: (err) => setRecomputeError(`Failed to start recompute: ${err.message}`),
  })

  // ---- Poll screener job ----
  const { data: screenJobStatus } = useQuery({
    queryKey: ["screener-job", screenJobId],
    queryFn: () => api.get(`/screener/job/${screenJobId}`),
    enabled: !!screenJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === "done" || status === "error") return false
      return 2000
    },
  })

  if (screenJobStatus?.status === "done" && screenJobId) {
    setScreenMeta(screenJobStatus.result)
    setScreenJobId(null)
    queryClient.invalidateQueries({ queryKey: ["screener-results"] })
  }
  if (screenJobStatus?.status === "error" && screenJobId) {
    setScreenError(`Screener failed: ${screenJobStatus.error}`)
    setScreenJobId(null)
  }

  // ---- Poll data refresh job ----
  const { data: refreshJobStatus } = useQuery({
    queryKey: ["screener-job", refreshJobId],
    queryFn: () => api.get(`/screener/job/${refreshJobId}`),
    enabled: !!refreshJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === "done" || status === "error") return false
      return 3000
    },
  })

  if (refreshJobStatus?.status === "done" && refreshJobId) {
    setRefreshMeta(refreshJobStatus.result)
    setRefreshJobId(null)
  }
  if (refreshJobStatus?.status === "error" && refreshJobId) {
    setRefreshError(`Data refresh failed: ${refreshJobStatus.error}`)
    setRefreshJobId(null)
  }

  // ---- Poll recompute job ----
  const { data: recomputeJobStatus } = useQuery({
    queryKey: ["screener-job", recomputeJobId],
    queryFn: () => api.get(`/screener/job/${recomputeJobId}`),
    enabled: !!recomputeJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === "done" || status === "error") return false
      return 3000
    },
  })

  if (recomputeJobStatus?.status === "done" && recomputeJobId) {
    setRecomputeMeta(recomputeJobStatus.result)
    setRecomputeJobId(null)
  }
  if (recomputeJobStatus?.status === "error" && recomputeJobId) {
    setRecomputeError(`Recompute failed: ${recomputeJobStatus.error}`)
    setRecomputeJobId(null)
  }

  const isScreening   = isStartingScreen    || (!!screenJobId    && screenJobStatus?.status    !== "done" && screenJobStatus?.status    !== "error")
  const isRefreshing  = isStartingRefresh   || (!!refreshJobId   && refreshJobStatus?.status   !== "done" && refreshJobStatus?.status   !== "error")
  const isRecomputing = isStartingRecompute || (!!recomputeJobId && recomputeJobStatus?.status !== "done" && recomputeJobStatus?.status !== "error")

  const screenButtonLabel    = isStartingScreen    ? "Starting…" : isScreening    ? "Screening…"   : "Screen Tickers"
  const refreshButtonLabel   = isStartingRefresh   ? "Starting…" : isRefreshing   ? "Refreshing…"  : "Refresh Data"
  const recomputeButtonLabel = isStartingRecompute ? "Starting…" : isRecomputing  ? "Computing…"   : "Recompute Indicators"

  const lastRunAt = results?.[0]?.run_at ?? null

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Screener</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            S&amp;P 500 candidates — data refreshed automatically every Saturday night
          </p>
          {lastRunAt && (
            <p className="text-xs text-muted-foreground mt-1">
              Last run: {fmtRunAt(lastRunAt)}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Button
            onClick={() => startScreen()}
            disabled={isScreening || isRefreshing}
          >
            {screenButtonLabel}
          </Button>
          {screenError && (
            <p className="text-xs text-destructive max-w-xs text-right">{screenError}</p>
          )}
        </div>
      </div>

      {/* Progress message while screening */}
      {isScreening && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground flex items-center gap-2"
        >
          <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
          Applying signal filters to cached data…
        </div>
      )}

      {/* Progress message while recompute is running */}
      {isRecomputing && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground flex items-center gap-2"
        >
          <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
          Recomputing indicators for all tickers — this takes a minute or two…
        </div>
      )}

      {/* Progress message while data refresh is running */}
      {isRefreshing && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground flex items-center gap-2"
        >
          <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
          Fetching OHLCV &amp; computing indicators for 500+ symbols — this takes several minutes…
        </div>
      )}

      {/* Results */}
      {isLoading && <ResultsSkeleton />}

      {!isLoading && (isError || (results && results.length === 0)) && (
        <div
          role="status"
          className="mt-4 rounded-lg border border-border bg-muted/50 px-4 py-8 text-center text-muted-foreground"
        >
          No screener results yet — the screener runs automatically every Saturday night.
        </div>
      )}

      {results && results.length > 0 && (
        <>
          <ResultsTable rows={results} />
          <ResultsCards rows={results} />
          {screenMeta && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-3">
              {screenMeta.run_at      && <span>Run: {fmtRunAt(screenMeta.run_at)}</span>}
              {screenMeta.pass1_count != null && <span>Pass 1: {screenMeta.pass1_count} candidates</span>}
              {screenMeta.pass2_count != null && <span>Pass 2: {screenMeta.pass2_count} with signals</span>}
            </div>
          )}
        </>
      )}

      <AdminPanel
        onRefresh={() => startRefresh()}
        isRefreshing={isRefreshing}
        refreshError={refreshError}
        refreshButtonLabel={refreshButtonLabel}
        refreshMeta={refreshMeta}
        onRecompute={() => startRecompute()}
        isRecomputing={isRecomputing}
        recomputeError={recomputeError}
        recomputeButtonLabel={recomputeButtonLabel}
        recomputeMeta={recomputeMeta}
      />
    </div>
  )
}
