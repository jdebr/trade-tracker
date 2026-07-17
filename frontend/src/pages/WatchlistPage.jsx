import { useState, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Trash2, Target, RefreshCw, FlaskConical } from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip } from "@/components/ui/Tooltip"
import { ConfirmDialog } from "@/components/ui/Dialog"
import { Combobox } from "@/components/ui/Combobox"
import { SortHeader } from "@/components/ui/SortHeader"
import ExitPlanDialog from "@/components/ExitPlanDialog"
import { INDICATORS } from "@/lib/indicators"
import { useSort } from "@/lib/useSort"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Indicator colour + format helpers
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
      className={cn("inline-block w-2.5 h-2.5 rounded-full", value ? "bg-green-500" : "bg-muted-foreground/30")}
      aria-label={value ? "true" : "false"}
    />
  )
}

const fmt = (n, d = 2) => (n != null ? Number(n).toFixed(d) : "—")

function fmtDatetime(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  })
}

function indicatorTip(key) {
  const ind = INDICATORS[key]
  return ind ? `${ind.description} ${ind.interpretation}` : null
}

// ---------------------------------------------------------------------------
// Group colours
// ---------------------------------------------------------------------------
const GROUP_COLOURS = [
  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
  "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400",
]
const groupColour = (() => {
  const cache = {}
  let idx = 0
  return (name) => {
    if (!name) return "bg-muted text-muted-foreground"
    if (!cache[name]) cache[name] = GROUP_COLOURS[idx++ % GROUP_COLOURS.length]
    return cache[name]
  }
})()

// ---------------------------------------------------------------------------
// Update status bar (was the Scanner's scheduler bar; "scan" → "update")
// ---------------------------------------------------------------------------

function UpdateStatusBar({ onUpdate, isUpdating, updateError }) {
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
        <span>Last update: <strong className="text-foreground">{lastRun}</strong></span>
        {!paused && <span>Next update: <strong className="text-foreground">{nextRun}</strong></span>}
        {paused && (
          <span className="text-amber-600 dark:text-amber-400 font-medium">
            Updates paused until {fmtDatetime(status.pause_until)}
          </span>
        )}
        <span>
          {(() => {
            const u = status?.td_api_usage
            if (!u) return <>API credits: <strong className="text-foreground">—/—</strong></>
            if (u.daily_usage != null && u.daily_limit != null)
              return <>API credits: <strong className="text-foreground">{u.daily_usage}/{u.daily_limit}</strong> today</>
            return <>API credits: <strong className="text-foreground">{u.current_usage}/{u.plan_limit}</strong> /min</>
          })()}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {updateError && <span role="alert" className="text-destructive">{updateError}</span>}
        {cooldown != null && !isUpdating && (
          <span className="text-muted-foreground">Cooldown: {Math.ceil(cooldown / 60)}m remaining</span>
        )}
        <Button
          variant="outline" size="sm" onClick={onUpdate}
          disabled={isUpdating || cooldown != null}
          aria-label="Update watchlist now"
        >
          <RefreshCw size={13} className={cn("mr-1.5", isUpdating && "animate-spin")} aria-hidden="true" />
          {isUpdating ? "Updating…" : "Update Now"}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add form
// ---------------------------------------------------------------------------

function AddForm({ onAdd, isAdding, error, groupOptions, tickerOptions, symbolSource, onToggleSource }) {
  const [symbol, setSymbol] = useState("")
  const [group,  setGroup]  = useState("")

  const symbolIsValid = !!tickerOptions.find(
    (t) => (t.symbol || t).toUpperCase() === symbol.trim().toUpperCase()
  )

  function handleSubmit(e) {
    e.preventDefault()
    const sym = symbol.trim().toUpperCase()
    if (!sym || !symbolIsValid) return
    onAdd({ symbol: sym, group_name: group.trim() || null })
    setSymbol("")
    setGroup("")
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 mb-5">
      <div className="flex flex-col gap-1">
        <Combobox
          value={symbol} onChange={setSymbol} options={tickerOptions}
          placeholder="Add symbol (e.g. AAPL)" allowNew={false}
          aria-label="Ticker symbol" className="w-44"
        />
        <div className="flex rounded-md border border-border overflow-hidden w-44 text-xs">
          {["Universe", "Screener"].map((label) => {
            const val = label.toLowerCase()
            return (
              <button
                key={val} type="button"
                onClick={() => { onToggleSource(val); setSymbol("") }}
                className={`flex-1 px-2 py-1 font-medium transition-colors ${
                  symbolSource === val
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
      <Combobox
        value={group} onChange={setGroup} options={groupOptions}
        placeholder="Group (optional)" allowNew={true}
        aria-label="Group name" className="w-44"
      />
      <Button type="submit" disabled={isAdding || !symbolIsValid} size="sm" className="self-start">
        {isAdding ? "Adding…" : "Add"}
      </Button>
      {error && <p role="alert" className="w-full text-xs text-destructive mt-1">{error}</p>}
    </form>
  )
}

function GroupFilterBar({ groups, active, onSelect }) {
  if (groups.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {["All", ...groups].map((g) => (
        <button
          key={g}
          onClick={() => onSelect(g === "All" ? null : g)}
          className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
            (g === "All" && active === null) || g === active
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          {g}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row actions (icon-only → tooltips)
// ---------------------------------------------------------------------------

function RowActions({ entry, name, onPlan, onRemove }) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Tooltip content={`Plan a trade for ${name || entry.symbol}`}>
        <Button
          variant="outline" size="sm" className="h-7 w-7 p-0"
          aria-label={`Plan a trade for ${entry.symbol}`}
          onClick={() => onPlan(entry)}
        >
          <Target size={14} aria-hidden="true" />
        </Button>
      </Tooltip>
      <Tooltip content={`Remove ${entry.symbol} from watchlist`}>
        <button
          onClick={() => onRemove(entry.symbol)}
          aria-label={`Remove ${entry.symbol}`}
          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  )
}

function OpenBadge() {
  return (
    <Tooltip content="You hold an open position in this ticker.">
      <Badge variant="bull" className="gap-1 cursor-help">
        <FlaskConical size={10} aria-hidden="true" /> Open
      </Badge>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// Table (desktop) — watchlist rows with indicator columns
// ---------------------------------------------------------------------------

function WatchlistTable({ rows, nameMap, openSymbols, sortKey, sortDir, onSort, onPlan, onRemove }) {
  const headerProps = { activeKey: sortKey, dir: sortDir, onSort }
  return (
    <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-muted-foreground">
            <SortHeader label="Symbol" sortKey="symbol" {...headerProps} />
            <SortHeader label="Price" sortKey="price" align="right" {...headerProps} />
            <SortHeader label="RSI" sortKey="rsi_14" align="right" tooltip={indicatorTip("rsi_14")} {...headerProps} />
            <SortHeader label="BB Squeeze" sortKey="bb_squeeze" align="center" tooltip={indicatorTip("bb_squeeze")} {...headerProps} />
            <SortHeader label="MACD Hist" sortKey="macd_hist" align="right" tooltip={indicatorTip("macd_hist")} {...headerProps} />
            <SortHeader label="EMA 50" sortKey="ema_50" align="right" tooltip={indicatorTip("ema_50")} {...headerProps} />
            <SortHeader label="ATR" sortKey="atr_14" align="right" tooltip={indicatorTip("atr_14")} {...headerProps} />
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.symbol} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Tooltip content={nameMap.get(row.symbol)}>
                    <span className="font-semibold tracking-wide cursor-default">{row.symbol}</span>
                  </Tooltip>
                  {row.group_name && (
                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", groupColour(row.group_name))}>
                      {row.group_name}
                    </span>
                  )}
                  {openSymbols.has(row.symbol) && <OpenBadge />}
                </div>
              </td>
              <td className="px-4 py-3 text-right tabular-nums font-medium">
                {row.price != null ? `$${Number(row.price).toFixed(2)}` : "—"}
              </td>
              <td className={cn("px-4 py-3 text-right tabular-nums font-medium", rsiColour(row.rsi_14))}>{fmt(row.rsi_14, 1)}</td>
              <td className="px-4 py-3 text-center"><BoolDot value={row.bb_squeeze} /></td>
              <td className={cn("px-4 py-3 text-right tabular-nums", macdColour(row.macd_hist))}>{fmt(row.macd_hist)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmt(row.ema_50, 2)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmt(row.atr_14, 2)}</td>
              <td className="px-4 py-3">
                <RowActions entry={row} name={nameMap.get(row.symbol)} onPlan={onPlan} onRemove={onRemove} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cards (mobile)
// ---------------------------------------------------------------------------

function WatchlistCards({ rows, nameMap, openSymbols, onPlan, onRemove }) {
  return (
    <div className="md:hidden space-y-3">
      {rows.map((row) => (
        <div key={row.symbol} className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3 gap-2">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <Tooltip content={nameMap.get(row.symbol)}>
                <span className="font-semibold tracking-wide cursor-default">{row.symbol}</span>
              </Tooltip>
              {row.group_name && (
                <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", groupColour(row.group_name))}>
                  {row.group_name}
                </span>
              )}
              {openSymbols.has(row.symbol) && <OpenBadge />}
            </div>
            <RowActions entry={row} name={nameMap.get(row.symbol)} onPlan={onPlan} onRemove={onRemove} />
          </div>
          <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Price</span>
              <span className="tabular-nums font-medium">
                {row.price != null ? `$${Number(row.price).toFixed(2)}` : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">RSI</span>
              <span className={cn("tabular-nums font-medium", rsiColour(row.rsi_14))}>{fmt(row.rsi_14, 1)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">BB Squeeze</span>
              <BoolDot value={row.bb_squeeze} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">MACD Hist</span>
              <span className={cn("tabular-nums", macdColour(row.macd_hist))}>{fmt(row.macd_hist)}</span>
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
// Page
// ---------------------------------------------------------------------------

function friendlyAddError(rawMessage) {
  if (!rawMessage) return null
  if (rawMessage.includes("duplicate") || rawMessage.includes("unique") || rawMessage.includes("409") || rawMessage.includes("23505"))
    return "That symbol is already in your watchlist."
  if (rawMessage.includes("foreign key") || rawMessage.includes("violates") || rawMessage.includes("422"))
    return "Symbol not found in the universe. Run the Screener first to sync tickers, then try again."
  return "Failed to add symbol. Check the ticker and try again."
}

export default function WatchlistPage() {
  const queryClient = useQueryClient()
  const [addError,      setAddError]      = useState(null)
  const [removeError,   setRemoveError]   = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [activeGroup,   setActiveGroup]   = useState(null)
  const [symbolSource,  setSymbolSource]  = useState("universe")
  const [updateError,   setUpdateError]   = useState(null)
  const [planningRow,   setPlanningRow]   = useState(null)

  // ---- Data ----
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["watchlist"],
    queryFn: () => api.get("/watchlist"),
  })

  const { data: tickerList = [] } = useQuery({
    queryKey: ["tickers"],
    queryFn: () => api.get("/tickers"),
    staleTime: 60 * 60 * 1000,
  })

  const { data: screenerResults = [] } = useQuery({
    queryKey: ["screener-results"],
    queryFn: () => api.get("/screener/results"),
    staleTime: 5 * 60 * 1000,
  })

  const symbols = entries.map((e) => e.symbol)

  const { data: snapshots = [] } = useQuery({
    queryKey: ["snapshots", symbols],
    queryFn: () => api.get(`/indicators/snapshots?symbols=${symbols.join(",")}`),
    enabled: symbols.length > 0,
  })

  const { data: quoteMap = {} } = useQuery({
    queryKey: ["ohlcv-quotes", symbols],
    queryFn: () => api.get(`/ohlcv/quotes?symbols=${symbols.join(",")}`),
    enabled: symbols.length > 0,
    staleTime: 60_000,
  })

  const { data: openPositions = [] } = useQuery({
    queryKey: ["positions", "open"],
    queryFn: () => api.get("/positions?status=open"),
    staleTime: 60_000,
  })

  const nameMap = useMemo(() => {
    const m = new Map()
    for (const t of tickerList) m.set(t.symbol, t.name)
    return m
  }, [tickerList])

  const snapBySymbol = useMemo(() => {
    const m = new Map()
    for (const s of snapshots) m.set(s.symbol, s)
    return m
  }, [snapshots])

  const openSymbols = useMemo(
    () => new Set(openPositions.map((p) => p.symbol)),
    [openPositions]
  )

  const tickerOptions = useMemo(() => {
    if (symbolSource === "screener") {
      const screenerSymbols = new Set(screenerResults.map((r) => r.symbol))
      return tickerList.filter((t) => screenerSymbols.has(t.symbol))
    }
    return tickerList
  }, [tickerList, screenerResults, symbolSource])

  const groupNames = useMemo(() => {
    const names = entries.map((e) => e.group_name).filter(Boolean)
    return [...new Set(names)].sort()
  }, [entries])

  // Rows = watchlist entries joined with their indicator snapshot + latest price.
  const rows = useMemo(() => {
    const filtered = activeGroup ? entries.filter((e) => e.group_name === activeGroup) : entries
    return filtered.map((e) => ({
      ...e,
      ...(snapBySymbol.get(e.symbol) || {}),
      price: quoteMap[e.symbol] ?? null,
    }))
  }, [entries, activeGroup, snapBySymbol, quoteMap])

  const { sorted, sortKey, sortDir, requestSort } = useSort(rows, { key: "symbol", dir: "asc" })

  const hasAnySnapshot = snapshots.length > 0

  // ---- Mutations ----
  const { mutate: addEntry, isPending: isAdding } = useMutation({
    mutationFn: (body) => api.post("/watchlist", body),
    onSuccess: () => {
      setAddError(null)
      queryClient.invalidateQueries({ queryKey: ["watchlist"] })
    },
    onError: (err) => setAddError(friendlyAddError(err.message)),
  })

  const { mutate: removeEntry, isPending: isRemoving } = useMutation({
    mutationFn: (symbol) => api.delete(`/watchlist/${encodeURIComponent(symbol)}`),
    onMutate: async (symbol) => {
      await queryClient.cancelQueries({ queryKey: ["watchlist"] })
      const previous = queryClient.getQueryData(["watchlist"])
      queryClient.setQueryData(["watchlist"], (old) => (old ?? []).filter((e) => e.symbol !== symbol))
      return { previous }
    },
    onSuccess: () => { setPendingDelete(null); setRemoveError(null) },
    onError: (err, symbol, context) => {
      queryClient.setQueryData(["watchlist"], context.previous)
      setPendingDelete(null)
      setRemoveError(`Failed to remove ${symbol}. Please try again.`)
    },
  })

  const { mutate: runUpdate, isPending: isUpdating } = useMutation({
    mutationFn: () => api.post("/scheduler/trigger"),
    onSuccess: () => {
      setUpdateError(null)
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["snapshots"] })
        queryClient.invalidateQueries({ queryKey: ["scheduler-status"] })
      }, 3000)
    },
    onError: (err) => {
      const msg = err.message.includes("429")
        ? err.message.replace(/^API 429: /, "").replace(/^"(.*)"$/, "$1")
        : "Failed to trigger an update. Check that the server is running."
      setUpdateError(msg)
    },
  })

  function handleConfirmRemove() {
    if (pendingDelete) removeEntry(pendingDelete)
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Watchlist</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Your tracked tickers and their live indicator readings
        </p>
      </div>

      <UpdateStatusBar
        onUpdate={() => runUpdate()}
        isUpdating={isUpdating}
        updateError={updateError}
      />

      <AddForm
        onAdd={addEntry}
        isAdding={isAdding}
        error={addError}
        groupOptions={groupNames}
        tickerOptions={tickerOptions}
        symbolSource={symbolSource}
        onToggleSource={setSymbolSource}
      />

      <GroupFilterBar groups={groupNames} active={activeGroup} onSelect={setActiveGroup} />

      {isLoading && (
        <div className="space-y-2" aria-label="Loading watchlist">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && entries.length === 0 && (
        <div className="rounded-lg border border-border bg-muted/50 px-4 py-10 text-center text-muted-foreground text-sm">
          Your watchlist is empty. Add a ticker above to get started.
        </div>
      )}

      {!isLoading && entries.length > 0 && rows.length === 0 && (
        <div className="rounded-lg border border-border bg-muted/50 px-4 py-10 text-center text-muted-foreground text-sm">
          No tickers in this group.
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <>
          {!hasAnySnapshot && (
            <div className="mb-3 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
              No indicator data yet. Click <strong>Update Now</strong> above, or wait for the scheduled 4:15 PM ET update.
            </div>
          )}
          <WatchlistTable
            rows={sorted} nameMap={nameMap} openSymbols={openSymbols}
            sortKey={sortKey} sortDir={sortDir} onSort={requestSort}
            onPlan={setPlanningRow} onRemove={setPendingDelete}
          />
          <WatchlistCards rows={sorted} nameMap={nameMap} openSymbols={openSymbols} onPlan={setPlanningRow} onRemove={setPendingDelete} />
        </>
      )}

      {removeError && <p role="alert" className="text-xs text-destructive mt-2">{removeError}</p>}

      {!isLoading && entries.length > 0 && (
        <p className="text-xs text-muted-foreground mt-3 text-right">
          {entries.length} ticker{entries.length !== 1 ? "s" : ""}
        </p>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null) }}
        title={`Remove ${pendingDelete} from watchlist?`}
        description="This cannot be undone."
        confirmLabel="Remove"
        confirmVariant="destructive"
        onConfirm={handleConfirmRemove}
        isPending={isRemoving}
      />

      {planningRow && (
        <ExitPlanDialog
          open={!!planningRow}
          onOpenChange={(o) => !o && setPlanningRow(null)}
          symbol={planningRow.symbol}
          suggestedEntry={planningRow.price ?? null}
        />
      )}
    </div>
  )
}
