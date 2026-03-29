import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

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
function AddForm({ onAdd, isAdding, error }) {
  const [symbol, setSymbol]   = useState("")
  const [group,  setGroup]    = useState("")

  function handleSubmit(e) {
    e.preventDefault()
    const sym = symbol.trim().toUpperCase()
    if (!sym) return
    onAdd({ symbol: sym, group_name: group.trim() || null })
    setSymbol("")
    setGroup("")
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 mb-6">
      <input
        type="text"
        value={symbol}
        onChange={(e) => setSymbol(e.target.value)}
        placeholder="Symbol (e.g. AAPL)"
        aria-label="Ticker symbol"
        maxLength={10}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm uppercase placeholder:normal-case placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring w-36"
      />
      <input
        type="text"
        value={group}
        onChange={(e) => setGroup(e.target.value)}
        placeholder="Group (optional)"
        aria-label="Group name"
        maxLength={30}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring w-40"
      />
      <Button type="submit" disabled={isAdding || !symbol.trim()} size="sm">
        {isAdding ? "Adding…" : "Add"}
      </Button>
      {error && (
        <p role="alert" className="w-full text-xs text-destructive mt-1">{error}</p>
      )}
    </form>
  )
}

// ---------------------------------------------------------------------------
// Entry row
// ---------------------------------------------------------------------------
function WatchlistRow({ entry, onRemove, isRemoving }) {
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
        onClick={() => onRemove(entry.symbol)}
        disabled={isRemoving}
        aria-label={`Remove ${entry.symbol}`}
        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
      >
        <Trash2 size={15} aria-hidden="true" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function WatchlistPage() {
  const queryClient = useQueryClient()
  const [addError, setAddError] = useState(null)
  const [removing, setRemoving] = useState(null)

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["watchlist"],
    queryFn: () => api.get("/watchlist"),
  })

  const { mutate: addEntry, isPending: isAdding } = useMutation({
    mutationFn: (body) => api.post("/watchlist", body),
    onSuccess: () => {
      setAddError(null)
      queryClient.invalidateQueries({ queryKey: ["watchlist"] })
    },
    onError: (err) => setAddError(err.message),
  })

  const { mutate: removeEntry } = useMutation({
    mutationFn: (symbol) => api.delete(`/watchlist/${symbol}`),
    onSuccess: () => {
      setRemoving(null)
      queryClient.invalidateQueries({ queryKey: ["watchlist"] })
    },
    onError: () => setRemoving(null),
  })

  function handleRemove(symbol) {
    setRemoving(symbol)
    removeEntry(symbol)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Watchlist</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Manage your tracked tickers
        </p>
      </div>

      <AddForm onAdd={addEntry} isAdding={isAdding} error={addError} />

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

        {!isLoading && entries.length > 0 && entries.map((entry) => (
          <WatchlistRow
            key={entry.id}
            entry={entry}
            onRemove={handleRemove}
            isRemoving={removing === entry.symbol}
          />
        ))}
      </div>

      {!isLoading && entries.length > 0 && (
        <p className="text-xs text-muted-foreground mt-3 text-right">
          {entries.length} ticker{entries.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  )
}
