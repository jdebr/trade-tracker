import { useState, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/ui/Dialog"
import { Combobox } from "@/components/ui/Combobox"

// ---------------------------------------------------------------------------
// Group colour mapping — cycles through a fixed palette
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
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 mb-6">
      <div className="flex flex-col gap-1">
        <Combobox
          value={symbol}
          onChange={setSymbol}
          options={tickerOptions}
          placeholder="Symbol (e.g. AAPL)"
          allowNew={false}
          aria-label="Ticker symbol"
          className="w-44"
        />
        {/* Source toggle */}
        <div className="flex rounded-md border border-border overflow-hidden w-44 text-xs">
          {["Universe", "Screener"].map((label) => {
            const val = label.toLowerCase()
            return (
              <button
                key={val}
                type="button"
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
        value={group}
        onChange={setGroup}
        options={groupOptions}
        placeholder="Group (optional)"
        allowNew={true}
        aria-label="Group name"
        className="w-44"
      />
      <Button type="submit" disabled={isAdding || !symbolIsValid} size="sm" className="self-start">
        {isAdding ? "Adding…" : "Add"}
      </Button>
      {error && (
        <p role="alert" className="w-full text-xs text-destructive mt-1">{error}</p>
      )}
    </form>
  )
}

// ---------------------------------------------------------------------------
// Group filter pills
// ---------------------------------------------------------------------------
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
// Entry row
// ---------------------------------------------------------------------------
function WatchlistRow({ entry, onRequestRemove }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-3">
        <span className="font-semibold tracking-wide w-16">{entry.symbol}</span>
        {entry.group_name && (
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${groupColour(entry.group_name)}`}>
            {entry.group_name}
          </span>
        )}
      </div>
      <button
        onClick={() => onRequestRemove(entry.symbol)}
        aria-label={`Remove ${entry.symbol}`}
        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
      >
        <Trash2 size={15} aria-hidden="true" />
      </button>
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
  const [addError,       setAddError]       = useState(null)
  const [removeError,    setRemoveError]     = useState(null)
  const [pendingDelete,  setPendingDelete]   = useState(null) // symbol awaiting confirm
  const [activeGroup,    setActiveGroup]     = useState(null)
  const [symbolSource,   setSymbolSource]    = useState("universe")

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

  const tickerOptions = useMemo(() => {
    if (symbolSource === "screener") {
      const screenerSymbols = new Set(screenerResults.map((r) => r.symbol))
      return tickerList.filter((t) => screenerSymbols.has(t.symbol))
    }
    return tickerList
  }, [tickerList, screenerResults, symbolSource])

  // Unique sorted group names derived from watchlist
  const groupNames = useMemo(() => {
    const names = entries
      .map((e) => e.group_name)
      .filter(Boolean)
    return [...new Set(names)].sort()
  }, [entries])

  // Group options for combobox (plain strings)
  const groupOptions = useMemo(() => groupNames, [groupNames])

  // Filtered + grouped display list
  const displayed = useMemo(() => {
    if (!activeGroup) return entries
    return entries.filter((e) => e.group_name === activeGroup)
  }, [entries, activeGroup])

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
      // Optimistic: remove the row immediately
      await queryClient.cancelQueries({ queryKey: ["watchlist"] })
      const previous = queryClient.getQueryData(["watchlist"])
      queryClient.setQueryData(["watchlist"], (old) =>
        (old ?? []).filter((e) => e.symbol !== symbol)
      )
      return { previous }
    },
    onSuccess: () => {
      setPendingDelete(null)
      setRemoveError(null)
    },
    onError: (err, symbol, context) => {
      // Revert optimistic update
      queryClient.setQueryData(["watchlist"], context.previous)
      setPendingDelete(null)
      setRemoveError(`Failed to remove ${symbol}. Please try again.`)
    },
  })

  function handleRequestRemove(symbol) {
    setPendingDelete(symbol)
    setRemoveError(null)
  }

  function handleConfirmRemove() {
    if (pendingDelete) removeEntry(pendingDelete)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Watchlist</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Manage your tracked tickers
        </p>
      </div>

      <AddForm
        onAdd={addEntry}
        isAdding={isAdding}
        error={addError}
        groupOptions={groupOptions}
        tickerOptions={tickerOptions}
        symbolSource={symbolSource}
        onToggleSource={setSymbolSource}
      />

      <GroupFilterBar
        groups={groupNames}
        active={activeGroup}
        onSelect={setActiveGroup}
      />

      <div className="rounded-lg border border-border bg-card">
        {isLoading && (
          <div className="p-4 space-y-3" aria-label="Loading watchlist">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}

        {!isLoading && entries.length === 0 && (
          <div className="px-4 py-10 text-center text-muted-foreground text-sm">
            Your watchlist is empty. Add a ticker above to get started.
          </div>
        )}

        {!isLoading && displayed.length === 0 && entries.length > 0 && (
          <div className="px-4 py-10 text-center text-muted-foreground text-sm">
            No entries in this group.
          </div>
        )}

        {!isLoading && displayed.map((entry) => (
          <WatchlistRow
            key={entry.id}
            entry={entry}
            onRequestRemove={handleRequestRemove}
          />
        ))}
      </div>

      {removeError && (
        <p role="alert" className="text-xs text-destructive mt-2">{removeError}</p>
      )}

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
    </div>
  )
}
