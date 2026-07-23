import { useState, useMemo } from "react"
import { Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Pencil, Copy, Trash2, RotateCcw, Info } from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip } from "@/components/ui/Tooltip"
import { ConfirmDialog } from "@/components/ui/Dialog"
import SignalRuleDialog from "@/components/SignalRuleDialog"
import { cn } from "@/lib/utils"

const MANAGE_KEY = ["signal-rules", "manage"]

// ---------------------------------------------------------------------------
// The on/off "light"
// ---------------------------------------------------------------------------

function LightToggle({ enabled, onToggle, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${enabled ? "Disable" : "Enable"} ${label}`}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background",
        enabled ? "bg-green-500" : "bg-muted-foreground/30",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
          enabled ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  )
}

// ---------------------------------------------------------------------------
// One signal row
// ---------------------------------------------------------------------------

function SignalRow({ rule, onToggle, onEdit, onClone, onDelete, onRestore, toggling }) {
  const removed = !!rule.deleted_at
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3 border-b border-border last:border-0",
        removed && "opacity-60"
      )}
    >
      {!removed && (
        <LightToggle
          enabled={rule.enabled}
          onToggle={() => onToggle(rule)}
          disabled={toggling}
          label={rule.name}
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{rule.name}</span>
          {rule.is_builtin && (
            <Tooltip content="A seeded builtin. You can rename, reweight, disable or remove it, but doing so stops its legacy Screener column from updating.">
              <Badge variant="secondary" className="cursor-help">builtin</Badge>
            </Tooltip>
          )}
          <span className="text-xs text-muted-foreground tabular-nums">×{rule.weight}</span>
        </div>
        <div className="text-xs text-muted-foreground font-mono truncate mt-0.5">
          {rule.formatted || JSON.stringify(rule.expression)}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {removed ? (
          <Tooltip content="Restore this signal">
            <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => onRestore(rule)}>
              <RotateCcw size={13} aria-hidden="true" /> Restore
            </Button>
          </Tooltip>
        ) : (
          <>
            <Tooltip content="Edit name, weight, description">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Edit ${rule.name}`} onClick={() => onEdit(rule)}>
                <Pencil size={14} aria-hidden="true" />
              </Button>
            </Tooltip>
            <Tooltip content="Clone — the only way to change a signal's logic">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Clone ${rule.name}`} onClick={() => onClone(rule)}>
                <Copy size={14} aria-hidden="true" />
              </Button>
            </Tooltip>
            <Tooltip content="Remove (soft delete)">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" aria-label={`Remove ${rule.name}`} onClick={() => onDelete(rule)}>
                <Trash2 size={14} aria-hidden="true" />
              </Button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SignalsPage() {
  const queryClient = useQueryClient()

  const [showRemoved, setShowRemoved] = useState(false)
  const [dialog, setDialog] = useState(null)   // { mode, rule?, initialExpression?, initialName? }
  const [confirmDelete, setConfirmDelete] = useState(null)

  const { data: rules, isLoading, isError } = useQuery({
    queryKey: MANAGE_KEY,
    queryFn: () => api.get("/signal-rules?include_deleted=true"),
    retry: false,
  })

  const { data: tickers = [] } = useQuery({
    queryKey: ["tickers"],
    queryFn: () => api.get("/tickers"),
    staleTime: 60 * 60 * 1000,
  })
  const { data: watchlist = [] } = useQuery({
    queryKey: ["watchlist"],
    queryFn: () => api.get("/watchlist"),
    staleTime: 5 * 60 * 1000,
  })
  const defaultSymbol = watchlist[0]?.symbol || "AAPL"

  const { active, removed } = useMemo(() => {
    const a = [], r = []
    for (const rule of rules ?? []) (rule.deleted_at ? r : a).push(rule)
    return { active: a, removed: r }
  }, [rules])

  // ---- Enable/disable (optimistic) ----
  const { mutate: toggleRule, isPending: toggling } = useMutation({
    mutationFn: ({ id, enabled }) => api.patch(`/signal-rules/${id}`, { enabled }),
    onMutate: async ({ id, enabled }) => {
      await queryClient.cancelQueries({ queryKey: MANAGE_KEY })
      const prev = queryClient.getQueryData(MANAGE_KEY)
      queryClient.setQueryData(MANAGE_KEY, (old = []) =>
        old.map((r) => (r.id === id ? { ...r, enabled } : r))
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(MANAGE_KEY, ctx.prev)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["signal-rules"] }),
  })

  const { mutate: deleteRule } = useMutation({
    mutationFn: (id) => api.delete(`/signal-rules/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signal-rules"] })
      setConfirmDelete(null)
    },
  })

  const { mutate: restoreRule } = useMutation({
    mutationFn: (id) => api.post(`/signal-rules/${id}/restore`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["signal-rules"] }),
  })

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Signals</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Named rules that score every ticker in the screener.
          </p>
        </div>
        <Button className="gap-1.5 shrink-0" onClick={() => setDialog({ mode: "create" })}>
          <Plus size={16} aria-hidden="true" /> New signal
        </Button>
      </div>

      {/* Re-run hint */}
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
        <Info size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
        <span>
          Adding, enabling, or reweighting a signal changes <strong>future</strong> screener runs — past
          results keep the scores they were computed with.{" "}
          <Link to="/screener" className="text-primary hover:underline">Re-run the Screener</Link> to
          score with your current signals.
        </span>
      </div>

      {/* List */}
      {isLoading && (
        <div className="space-y-2" aria-label="Loading signals">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && (isError || active.length === 0) && (
        <div
          role="status"
          className="rounded-lg border border-border bg-muted/50 px-4 py-8 text-center text-muted-foreground"
        >
          No signals yet — create one to start scoring the screener.
        </div>
      )}

      {active.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          {active.map((rule) => (
            <SignalRow
              key={rule.id}
              rule={rule}
              toggling={toggling}
              onToggle={(r) => toggleRule({ id: r.id, enabled: !r.enabled })}
              onEdit={(r) => setDialog({ mode: "edit", rule: r })}
              onClone={(r) => setDialog({ mode: "create", initialExpression: r.expression, initialName: `Copy of ${r.name}` })}
              onDelete={(r) => setConfirmDelete(r)}
            />
          ))}
        </div>
      )}

      {/* Removed */}
      {removed.length > 0 && (
        <div className="mt-4">
          <button
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowRemoved((v) => !v)}
          >
            {showRemoved ? "Hide" : "Show"} removed ({removed.length})
          </button>
          {showRemoved && (
            <div className="mt-2 rounded-lg border border-border overflow-hidden">
              {removed.map((rule) => (
                <SignalRow
                  key={rule.id}
                  rule={rule}
                  onRestore={(r) => restoreRule(r.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create / edit / clone dialog */}
      {dialog && (
        <SignalRuleDialog
          open={!!dialog}
          onOpenChange={(o) => !o && setDialog(null)}
          mode={dialog.mode}
          rule={dialog.rule}
          initialExpression={dialog.initialExpression}
          initialName={dialog.initialName}
          symbols={tickers}
          defaultSymbol={defaultSymbol}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={confirmDelete ? `Remove "${confirmDelete.name}"?` : ""}
        description={
          confirmDelete?.is_builtin
            ? "This soft-deletes the signal — you can restore it later. It's a builtin, so the Screener's legacy column for it will stop updating."
            : "This soft-deletes the signal. You can restore it later from “Show removed”."
        }
        confirmLabel="Remove"
        onConfirm={() => deleteRule(confirmDelete.id)}
      />
    </div>
  )
}
