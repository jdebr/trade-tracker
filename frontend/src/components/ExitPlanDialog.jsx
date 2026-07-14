import { useState, useEffect, useMemo } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { X, AlertTriangle, FlaskConical, Wallet } from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tooltip } from "@/components/ui/Tooltip"
import { STOP_METHODS, TARGET_METHODS, stopMethodTip, targetMethodTip } from "@/lib/exitMethods"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Small form primitives — local to this dialog
// ---------------------------------------------------------------------------

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
    </label>
  )
}

const inputClass =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-ring tabular-nums"

function NumberInput({ value, onChange, step = "0.01", ...props }) {
  return (
    <input
      type="number"
      step={step}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className={inputClass}
      {...props}
    />
  )
}

function Select({ value, onChange, options, ...props }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(inputClass, "cursor-pointer")}
      {...props}
    >
      {Object.entries(options).map(([key, meta]) => (
        <option key={key} value={key}>{meta.label}</option>
      ))}
    </select>
  )
}

function money(n) {
  return n == null ? "—" : `$${Number(n).toFixed(2)}`
}

// ---------------------------------------------------------------------------
// The levels the plan produced — stop, entry, target laid out as a risk ladder
// ---------------------------------------------------------------------------

function PlanSummary({ plan }) {
  const rrHealthy = plan.rr_ratio != null && plan.rr_ratio >= 1.5

  return (
    <div
      role="group"
      aria-label="Exit plan summary"
      className="rounded-lg border border-border bg-muted/30 p-3.5 space-y-3"
    >
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-[11px] text-muted-foreground mb-0.5">Stop</div>
          <div className="text-base font-semibold tabular-nums text-red-600 dark:text-red-400">
            {money(plan.stop_price)}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground mb-0.5">Entry</div>
          <div className="text-base font-semibold tabular-nums">{money(plan.entry_price)}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground mb-0.5">Target</div>
          <div className="text-base font-semibold tabular-nums text-green-600 dark:text-green-400">
            {money(plan.target_price)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs border-t border-border pt-3">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Shares</span>
          <span className="font-semibold tabular-nums">{plan.shares}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Reward : Risk</span>
          <span className={cn(
            "font-semibold tabular-nums",
            rrHealthy ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"
          )}>
            {plan.rr_ratio != null ? `${plan.rr_ratio.toFixed(2)} : 1` : "—"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Risk (1R)</span>
          <span className="font-semibold tabular-nums">{money(plan.risk_amount)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Position value</span>
          <span className="font-semibold tabular-nums">
            {money(plan.position_value)}
            <span className="text-muted-foreground font-normal ml-1">
              ({plan.position_pct_of_account?.toFixed(0)}%)
            </span>
          </span>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground border-t border-border pt-2.5">
        <strong className="text-foreground">1R = {money(plan.risk_amount)}</strong> — the amount you
        lose if the stop is hit. Every result for this trade is measured against it.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Side-by-side comparison of every level the app can compute
// ---------------------------------------------------------------------------

function CandidateTable({ title, candidates, meta, selected, onSelect, entryPrice }) {
  const rows = Object.entries(candidates).filter(([, price]) => price != null)
  if (rows.length === 0) return null

  return (
    <div role="group" aria-label={title}>
      <h4 className="text-xs font-medium text-muted-foreground mb-1.5">{title}</h4>
      <div className="rounded-md border border-border overflow-hidden">
        {rows.map(([method, price]) => {
          const distancePct = ((price - entryPrice) / entryPrice) * 100
          const isSelected = method === selected
          return (
            <button
              key={method}
              type="button"
              onClick={() => onSelect(method)}
              className={cn(
                "w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs border-b border-border last:border-0 transition-colors text-left",
                isSelected ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/50"
              )}
            >
              <Tooltip content={meta === STOP_METHODS ? stopMethodTip(method) : targetMethodTip(method)}>
                <span className="cursor-help">{meta[method]?.label ?? method}</span>
              </Tooltip>
              <span className="tabular-nums flex items-center gap-1.5">
                <span>{money(price)}</span>
                <span className="text-muted-foreground text-[10px] w-12 text-right">
                  {distancePct > 0 ? "+" : ""}{distancePct.toFixed(1)}%
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

/**
 * Exit strategy builder.
 *
 * Recalculates against POST /positions/plan on every input change, so the levels,
 * share count, and risk shown are always the ones the server would use. Confirming
 * opens the position with exactly the plan on screen.
 */
export default function ExitPlanDialog({
  open,
  onOpenChange,
  symbol,
  suggestedEntry = null,
  alertId = null,
  screenerResultId = null,
  onOpened,
}) {
  const queryClient = useQueryClient()

  const [entryPrice, setEntryPrice] = useState(suggestedEntry)
  const [stopMethod, setStopMethod] = useState(null)
  const [targetMethod, setTargetMethod] = useState(null)
  const [atrMult, setAtrMult] = useState(null)
  const [targetR, setTargetR] = useState(null)
  const [riskPct, setRiskPct] = useState(null)
  const [manualStop, setManualStop] = useState(null)
  const [manualTarget, setManualTarget] = useState(null)
  const [isSimulated, setIsSimulated] = useState(true)
  const [notes, setNotes] = useState("")
  const [openError, setOpenError] = useState(null)

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get("/settings"),
    staleTime: 5 * 60 * 1000,
  })

  // Seed the form from settings the first time they land.
  useEffect(() => {
    if (!settings) return
    setStopMethod((m) => m ?? settings.default_stop_method)
    setTargetMethod((m) => m ?? settings.default_target_method)
    setAtrMult((v) => v ?? settings.default_atr_mult)
    setTargetR((v) => v ?? settings.default_target_r)
    setRiskPct((v) => v ?? settings.risk_per_trade_pct)
  }, [settings])

  useEffect(() => {
    if (open) {
      setEntryPrice(suggestedEntry)
      setOpenError(null)
    }
  }, [open, suggestedEntry])

  const planRequest = useMemo(() => ({
    symbol,
    entry_price: entryPrice,
    stop_method: stopMethod,
    target_method: targetMethod,
    atr_mult: atrMult,
    target_r: targetR,
    risk_pct: riskPct,
    manual_stop: manualStop,
    manual_target: manualTarget,
  }), [symbol, entryPrice, stopMethod, targetMethod, atrMult, targetR, riskPct, manualStop, manualTarget])

  const planReady =
    open && !!symbol && entryPrice > 0 && !!stopMethod && !!targetMethod &&
    (stopMethod !== "manual" || manualStop > 0) &&
    (targetMethod !== "manual" || manualTarget > 0)

  const { data: plan, isLoading: planLoading, error: planError } = useQuery({
    queryKey: ["exit-plan", planRequest],
    queryFn: () => api.post("/positions/plan", planRequest),
    enabled: planReady,
    retry: false,
  })

  const { mutate: openPosition, isPending: isOpening } = useMutation({
    mutationFn: () => api.post("/positions", {
      symbol,
      entry_price: entryPrice,
      shares: plan.shares,
      stop_price: plan.stop_price,
      target_price: plan.target_price,
      is_simulated: isSimulated,
      stop_method: plan.stop_method,
      target_method: plan.target_method,
      exit_plan: plan.params,
      time_stop_date: plan.time_stop_date,
      alert_id: alertId,
      screener_result_id: screenerResultId,
      notes: notes || null,
    }),
    onSuccess: (position) => {
      queryClient.invalidateQueries({ queryKey: ["positions"] })
      onOpenChange(false)
      onOpened?.(position)
    },
    onError: (err) => {
      setOpenError(
        err.message.includes("400")
          ? "Could not open the position. Check the symbol is in the ticker universe."
          : "Failed to open the position. Check that the server is running."
      )
    },
  })

  // A 400 from /plan is a real validation message (stop above entry, etc.) —
  // surface it verbatim rather than a generic failure.
  const planErrorMessage = planError
    ? planError.message.replace(/^API \d+: /, "").replace(/^\{"detail":"(.*)"\}$/, "$1")
    : null

  const canOpen = plan && plan.shares > 0 && !isOpening

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2",
            "max-h-[92vh] overflow-y-auto",
            "rounded-lg border border-border bg-background p-5 shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          )}
          aria-describedby={undefined}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold flex items-center gap-2">
                Plan exit for <span className="tracking-wide">{symbol}</span>
                {isSimulated && (
                  <Badge variant="secondary" className="gap-1">
                    <FlaskConical size={11} aria-hidden="true" /> Simulated
                  </Badge>
                )}
              </DialogPrimitive.Title>
              <p className="text-xs text-muted-foreground mt-0.5">
                Set the stop and target before you enter, not after.
              </p>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </DialogPrimitive.Close>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            {/* ---------------- Inputs ---------------- */}
            <div className="space-y-3">
              <Field label="Entry price">
                <NumberInput
                  value={entryPrice}
                  onChange={setEntryPrice}
                  aria-label="Entry price"
                  autoFocus
                />
              </Field>

              <Field label="Stop method">
                <Select
                  value={stopMethod ?? ""}
                  onChange={setStopMethod}
                  options={STOP_METHODS}
                  aria-label="Stop method"
                />
              </Field>

              {stopMethod === "atr_multiple" && (
                <Field label="ATR multiplier" hint="2–3× is the usual swing range.">
                  <NumberInput value={atrMult} onChange={setAtrMult} step="0.1" aria-label="ATR multiplier" />
                </Field>
              )}
              {stopMethod === "manual" && (
                <Field label="Stop price">
                  <NumberInput value={manualStop} onChange={setManualStop} aria-label="Stop price" />
                </Field>
              )}

              <Field label="Target method">
                <Select
                  value={targetMethod ?? ""}
                  onChange={setTargetMethod}
                  options={TARGET_METHODS}
                  aria-label="Target method"
                />
              </Field>

              {targetMethod === "r_multiple" && (
                <Field label="Target R" hint="2R makes twice what the trade risks.">
                  <NumberInput value={targetR} onChange={setTargetR} step="0.5" aria-label="Target R" />
                </Field>
              )}
              {targetMethod === "manual" && (
                <Field label="Target price">
                  <NumberInput value={manualTarget} onChange={setManualTarget} aria-label="Target price" />
                </Field>
              )}

              <Field
                label="Risk per trade (%)"
                hint={settings ? `Account: $${Number(settings.account_size).toLocaleString()}` : null}
              >
                <NumberInput value={riskPct} onChange={setRiskPct} step="0.25" aria-label="Risk per trade percent" />
              </Field>

              <Field label="Notes">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Why this trade?"
                  aria-label="Notes"
                  className={cn(inputClass, "resize-none")}
                />
              </Field>
            </div>

            {/* ---------------- Result ---------------- */}
            <div className="space-y-3">
              {!planReady && (
                <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                  Enter a price to see the plan.
                </div>
              )}

              {planReady && planLoading && (
                <div className="rounded-lg border border-border bg-muted/30 px-4 py-8 text-center text-xs text-muted-foreground animate-pulse">
                  Calculating…
                </div>
              )}

              {planErrorMessage && (
                <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                  {planErrorMessage}
                </div>
              )}

              {plan && !planLoading && (
                <>
                  <PlanSummary plan={plan} />

                  {plan.warnings.length > 0 && (
                    <div className="space-y-1.5">
                      {plan.warnings.map((w, i) => (
                        <div
                          key={i}
                          role="alert"
                          className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-400"
                        >
                          <AlertTriangle size={13} className="shrink-0 mt-0.5" aria-hidden="true" />
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <CandidateTable
                    title="Compare stop levels"
                    candidates={plan.stop_candidates}
                    meta={STOP_METHODS}
                    selected={plan.stop_method}
                    onSelect={setStopMethod}
                    entryPrice={plan.entry_price}
                  />
                  <CandidateTable
                    title="Compare targets"
                    candidates={plan.target_candidates}
                    meta={TARGET_METHODS}
                    selected={plan.target_method}
                    onSelect={setTargetMethod}
                    entryPrice={plan.entry_price}
                  />
                </>
              )}
            </div>
          </div>

          {/* ---------------- Footer ---------------- */}
          <div className="mt-5 pt-4 border-t border-border flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={!isSimulated}
                onChange={(e) => setIsSimulated(!e.target.checked)}
                className="rounded border-input"
                aria-label="Real money position"
              />
              <span className="flex items-center gap-1.5">
                <Wallet size={13} aria-hidden="true" />
                Real money
                <span className="text-muted-foreground">
                  (leave unchecked to paper trade)
                </span>
              </span>
            </label>

            <div className="flex items-center gap-2">
              {openError && (
                <span role="alert" className="text-xs text-destructive">{openError}</span>
              )}
              <DialogPrimitive.Close asChild>
                <Button variant="outline" size="sm" disabled={isOpening}>Cancel</Button>
              </DialogPrimitive.Close>
              <Button size="sm" onClick={() => openPosition()} disabled={!canOpen}>
                {isOpening
                  ? "Opening…"
                  : `Open ${isSimulated ? "simulated " : ""}position`}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
