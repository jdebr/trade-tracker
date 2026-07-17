import { useState, useMemo, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X, FlaskConical, Briefcase } from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip } from "@/components/ui/Tooltip"
import { SortHeader } from "@/components/ui/SortHeader"
import { EXIT_REASONS } from "@/lib/exitMethods"
import { useSort } from "@/lib/useSort"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const money = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`)
const pct   = (n) => (n == null ? "—" : `${Number(n) >= 0 ? "+" : ""}${Number(n).toFixed(1)}%`)

function rMultiple(n) {
  if (n == null) return "—"
  const v = Number(n)
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"
}

/** Green above break-even, red below. Applied to both realized and unrealized R. */
function pnlColour(n) {
  if (n == null) return "text-muted-foreground"
  return Number(n) >= 0
    ? "text-green-600 dark:text-green-400"
    : "text-red-500 dark:text-red-400"
}

function SimBadge({ isSimulated }) {
  return isSimulated ? (
    <Tooltip content="Paper trade — no real money at risk. Kept separate from live results.">
      <Badge variant="secondary" className="gap-1 cursor-help">
        <FlaskConical size={10} aria-hidden="true" /> SIM
      </Badge>
    </Tooltip>
  ) : (
    <Tooltip content="Real money position.">
      <Badge variant="default" className="cursor-help">LIVE</Badge>
    </Tooltip>
  )
}

/**
 * Where price sits between the stop and the target.
 * A trade nearing its stop reads very differently from one nearing its target,
 * and a number alone doesn't convey that at a glance.
 */
function ProgressBar({ stop, entry, target, current }) {
  if (!current || !stop || !target) return null

  const span = target - stop
  const clamp = (v) => Math.max(0, Math.min(100, v))
  const pricePos = clamp(((current - stop) / span) * 100)
  const entryPos = clamp(((entry - stop) / span) * 100)
  const inProfit = current >= entry

  return (
    <div className="relative h-1.5 w-full rounded-full bg-muted overflow-visible" aria-hidden="true">
      <div
        className={cn(
          "absolute top-0 h-1.5 rounded-full",
          inProfit ? "bg-green-500/40" : "bg-red-500/40"
        )}
        style={
          inProfit
            ? { left: `${entryPos}%`, width: `${pricePos - entryPos}%` }
            : { left: `${pricePos}%`, width: `${entryPos - pricePos}%` }
        }
      />
      {/* entry marker */}
      <div
        className="absolute top-[-2px] w-px h-[10px] bg-muted-foreground/60"
        style={{ left: `${entryPos}%` }}
      />
      {/* current price marker */}
      <div
        className={cn(
          "absolute top-[-3px] w-2 h-2 rounded-full border-2 border-background",
          inProfit ? "bg-green-500" : "bg-red-500"
        )}
        style={{ left: `calc(${pricePos}% - 4px)` }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Close dialog
// ---------------------------------------------------------------------------

function ClosePositionDialog({ position, defaultPrice, open, onOpenChange }) {
  const queryClient = useQueryClient()
  const [exitPrice, setExitPrice] = useState("")
  const [exitReason, setExitReason] = useState("manual")
  const [notes, setNotes] = useState("")
  const [error, setError] = useState(null)

  // Prefill the exit with the last known price when the dialog opens. The dialog
  // instance is reused across positions, so this keys on open+symbol rather than
  // relying on useState's mount-only initializer.
  useEffect(() => {
    if (open) {
      setExitPrice(defaultPrice != null ? String(defaultPrice) : "")
      setExitReason("manual")
      setNotes("")
      setError(null)
    }
  }, [open, position?.id, defaultPrice])

  const { mutate: close, isPending } = useMutation({
    mutationFn: () => api.post(`/positions/${position.id}/close`, {
      exit_price: Number(exitPrice),
      exit_reason: exitReason,
      notes: notes || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["positions"] })
      onOpenChange(false)
      setExitPrice(""); setNotes(""); setError(null)
    },
    onError: () => setError("Failed to close the position. Check that the server is running."),
  })

  // Preview the outcome before committing — R is measured against the INITIAL
  // stop, which is what the server will use too.
  const preview = useMemo(() => {
    const px = Number(exitPrice)
    if (!px || !position) return null
    const entry = Number(position.entry_price)
    const risk  = entry - Number(position.initial_stop_price)
    return {
      pnl: (px - entry) * Number(position.shares),
      r: risk > 0 ? (px - entry) / risk : null,
    }
  }, [exitPrice, position])

  if (!position) return null

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-5 shadow-lg"
          aria-describedby={undefined}
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              Close {position.symbol}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <button className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Close">
                <X size={16} />
              </button>
            </DialogPrimitive.Close>
          </div>

          <div className="space-y-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Exit price</span>
              <input
                type="number"
                step="0.01"
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
                aria-label="Exit price"
                autoFocus
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Reason</span>
              <select
                value={exitReason}
                onChange={(e) => setExitReason(e.target.value)}
                aria-label="Exit reason"
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {Object.entries(EXIT_REASONS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Notes</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="What did you learn?"
                aria-label="Notes"
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            {preview && (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 flex justify-between text-xs">
                <span className="text-muted-foreground">Result</span>
                <span className={cn("font-semibold tabular-nums", pnlColour(preview.pnl))}>
                  {preview.pnl >= 0 ? "+" : "−"}${Math.abs(preview.pnl).toFixed(2)}
                  <span className="ml-1.5">({rMultiple(preview.r)})</span>
                </span>
              </div>
            )}

            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <DialogPrimitive.Close asChild>
              <Button variant="outline" size="sm" disabled={isPending}>Cancel</Button>
            </DialogPrimitive.Close>
            <Button size="sm" onClick={() => close()} disabled={!exitPrice || isPending}>
              {isPending ? "Closing…" : "Close position"}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

// ---------------------------------------------------------------------------
// Open positions
// ---------------------------------------------------------------------------

function OpenPositionCard({ position, quote, onClose }) {
  const entry   = Number(position.entry_price)
  const stop    = Number(position.stop_price)
  const target  = position.target_price ? Number(position.target_price) : null
  const risk    = Number(position.risk_per_share)
  const current = quote ?? null

  const unrealizedR   = current && risk > 0 ? (current - entry) / risk : null
  const unrealizedPnl = current ? (current - entry) * Number(position.shares) : null

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold tracking-wide">{position.symbol}</span>
          <SimBadge isSimulated={position.is_simulated} />
          <span className="text-xs text-muted-foreground">
            {position.shares} sh · entered {fmtDate(position.entry_date)}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={() => onClose(position)}>
          Close
        </Button>
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1.5">
          <span className="text-red-500 dark:text-red-400 tabular-nums">{money(stop)}</span>
          <span className={cn("font-semibold tabular-nums", pnlColour(unrealizedR))}>
            {current ? money(current) : "—"}
            {unrealizedR != null && (
              <span className="ml-1.5">{rMultiple(unrealizedR)}</span>
            )}
          </span>
          <span className="text-green-600 dark:text-green-400 tabular-nums">{money(target)}</span>
        </div>
        <ProgressBar stop={stop} entry={entry} target={target} current={current} />
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs border-t border-border pt-2.5">
        <div>
          <div className="text-muted-foreground mb-0.5">Entry</div>
          <div className="tabular-nums font-medium">{money(entry)}</div>
        </div>
        <div>
          <div className="text-muted-foreground mb-0.5">Risk (1R)</div>
          <div className="tabular-nums font-medium">{money(position.risk_amount)}</div>
        </div>
        <div>
          <div className="text-muted-foreground mb-0.5">Unrealized</div>
          <div className={cn("tabular-nums font-medium", pnlColour(unrealizedPnl))}>
            {unrealizedPnl == null
              ? "—"
              : `${unrealizedPnl >= 0 ? "+" : "−"}$${Math.abs(unrealizedPnl).toFixed(2)}`}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Closed positions
// ---------------------------------------------------------------------------

function ClosedTable({ positions }) {
  // Default to most-recently-closed first.
  const { sorted, sortKey, sortDir, requestSort } = useSort(positions, { key: "exit_date", dir: "desc" })
  const headerProps = { activeKey: sortKey, dir: sortDir, onSort: requestSort }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-muted-foreground">
            <SortHeader label="Symbol" sortKey="symbol" {...headerProps} />
            <SortHeader label="Entry" sortKey="entry_price" align="right" {...headerProps} />
            <SortHeader label="Exit" sortKey="exit_price" align="right" {...headerProps} />
            <SortHeader label="P&L" sortKey="pnl" align="right" {...headerProps} />
            <SortHeader label="R" sortKey="r_multiple" align="right" {...headerProps} />
            <SortHeader label="Held" sortKey="hold_days" align="right" {...headerProps} />
            <SortHeader label="Reason" sortKey="exit_reason" {...headerProps} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-semibold tracking-wide">{p.symbol}</span>
                  <SimBadge isSimulated={p.is_simulated} />
                </div>
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{money(p.entry_price)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{money(p.exit_price)}</td>
              <td className={cn("px-4 py-2.5 text-right tabular-nums font-medium", pnlColour(p.pnl))}>
                {p.pnl == null ? "—" : `${p.pnl >= 0 ? "+" : "−"}$${Math.abs(p.pnl).toFixed(2)}`}
                <span className="block text-[11px] font-normal text-muted-foreground">{pct(p.pnl_pct)}</span>
              </td>
              <td className={cn("px-4 py-2.5 text-right tabular-nums font-semibold", pnlColour(p.r_multiple))}>
                {rMultiple(p.r_multiple)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                {p.hold_days != null ? `${p.hold_days}d` : "—"}
              </td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">
                {EXIT_REASONS[p.exit_reason] ?? p.exit_reason ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PositionsPage() {
  const [closing, setClosing] = useState(null)

  const { data: positions = [], isLoading } = useQuery({
    queryKey: ["positions"],
    queryFn: () => api.get("/positions?limit=200"),
  })

  const open   = positions.filter((p) => p.status === "open")
  const closed = positions.filter((p) => p.status === "closed")

  // Latest close per open-position symbol. A missing quote degrades the card to
  // "—" rather than blocking the page.
  const { data: quoteMap = {} } = useQuery({
    queryKey: ["position-quotes"],
    queryFn: () => api.get("/positions/quotes"),
    enabled: open.length > 0,
    staleTime: 60_000,
  })

  const quotes = useMemo(
    () => new Map(Object.entries(quoteMap).map(([s, p]) => [s, Number(p)])),
    [quoteMap]
  )

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold">Positions</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Trades you're in, and how the closed ones turned out
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3" aria-label="Loading positions">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && positions.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-muted/30 py-16 gap-3">
          <Briefcase size={32} className="text-muted-foreground/50" aria-hidden="true" />
          <p className="text-muted-foreground text-sm text-center max-w-sm">
            No positions yet. Open one from the <strong>Screener</strong> or{" "}
            <strong>Watchlist</strong> — simulated by default, so you can build a
            track record before risking real money.
          </p>
        </div>
      )}

      {!isLoading && open.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            Open ({open.length})
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {open.map((p) => (
              <OpenPositionCard
                key={p.id}
                position={p}
                quote={quotes.get(p.symbol)}
                onClose={setClosing}
              />
            ))}
          </div>
        </section>
      )}

      {!isLoading && closed.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            Closed ({closed.length})
          </h2>
          <ClosedTable positions={closed} />
        </section>
      )}

      <ClosePositionDialog
        position={closing}
        defaultPrice={closing ? quotes.get(closing.symbol) : null}
        open={!!closing}
        onOpenChange={(o) => !o && setClosing(null)}
      />
    </div>
  )
}
