import { useState, useEffect, useMemo } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { X, Check, AlertTriangle, Globe, Lock } from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/Combobox"
import { useDebounce } from "@/lib/useDebounce"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Local form primitives
// ---------------------------------------------------------------------------

const inputClass =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-ring"

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
    </label>
  )
}

const PREVIEW_SYMBOL_KEY = "signalPreviewSymbol"

function stringifyExpr(expr) {
  try {
    return JSON.stringify(expr ?? {}, null, 2)
  } catch {
    return ""
  }
}

function friendlyError(err) {
  const m = err?.message || ""
  if (m.includes("409")) return "A signal with this name already exists — pick a different name."
  if (m.includes("422")) return "The expression is invalid. Fix the errors shown, then save."
  return "Could not save the signal. Check that the server is running."
}

function fmtNum(v) {
  if (v == null) return "—"
  if (typeof v === "boolean") return v ? "true" : "false"
  return typeof v === "number" ? +v.toFixed(2) : String(v)
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

/**
 * Signal builder (M19b.2, raw-JSON mode).
 *
 * Create/clone: author a JsonLogic expression, live-validated against
 * /rules/validate, with a single-symbol live check (/rules/preview) and a
 * full-universe "how many would this match" pass (/rules/preview-universe).
 *
 * Edit: name/description/weight only — the expression is immutable once created,
 * so it renders read-only and the user is pointed at Clone to change the logic.
 */
export default function SignalRuleDialog({
  open,
  onOpenChange,
  mode = "create",           // "create" | "edit"  (clone = create + seeds)
  rule = null,               // the rule being edited
  initialExpression = null,  // create/clone prefill
  initialName = "",
  symbols = [],              // [{symbol, name}] for the preview picker
  defaultSymbol = "AAPL",
}) {
  const queryClient = useQueryClient()
  const isEdit = mode === "edit"

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [weight, setWeight] = useState(1)
  const [type, setType] = useState("")
  const [exprText, setExprText] = useState("")
  const [previewSymbol, setPreviewSymbol] = useState(
    () => localStorage.getItem(PREVIEW_SYMBOL_KEY) || defaultSymbol
  )
  const [saveError, setSaveError] = useState(null)
  const [universeResult, setUniverseResult] = useState(null)

  // Seed the form each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setSaveError(null)
    setUniverseResult(null)
    if (isEdit && rule) {
      setName(rule.name ?? "")
      setDescription(rule.description ?? "")
      setWeight(rule.weight ?? 1)
      setType(rule.type ?? "")
      setExprText(stringifyExpr(rule.expression))
    } else {
      setName(initialName ?? "")
      setDescription("")
      setWeight(1)
      setType("")
      setExprText(initialExpression ? stringifyExpr(initialExpression) : "")
    }
  }, [open, isEdit, rule, initialName, initialExpression])

  useEffect(() => {
    if (previewSymbol) localStorage.setItem(PREVIEW_SYMBOL_KEY, previewSymbol)
  }, [previewSymbol])

  // Parse whatever is in the editor right now.
  const parsed = useMemo(() => {
    const text = exprText.trim()
    if (!text) return { ok: false, empty: true }
    try {
      return { ok: true, value: JSON.parse(text) }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }, [exprText])

  const debouncedText = useDebounce(exprText, 400)
  const settled = debouncedText.trim() === exprText.trim()
  const debouncedParsed = useMemo(() => {
    const text = debouncedText.trim()
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }, [debouncedText])

  // Live validate — server owns the human-readable string + error list.
  const { data: validation } = useQuery({
    queryKey: ["rule-validate", debouncedParsed],
    queryFn: () => api.post("/rules/validate", { rule: debouncedParsed }),
    enabled: open && !!debouncedParsed,
    placeholderData: keepPreviousData,
  })

  // Single-symbol live preview (only when the rule is valid).
  const { data: preview } = useQuery({
    queryKey: ["rule-preview", debouncedParsed, previewSymbol],
    queryFn: () => api.post("/rules/preview", { rule: debouncedParsed, symbol: previewSymbol }),
    enabled: open && !!debouncedParsed && !!previewSymbol && !!validation?.valid,
    placeholderData: keepPreviousData,
  })

  // Full-universe preview — button-triggered, not per-keystroke.
  const { mutate: runUniverse, isPending: universePending } = useMutation({
    mutationFn: () => api.post("/rules/preview-universe", { rule: parsed.value }),
    onSuccess: (res) => setUniverseResult(res),
    onError: () => setUniverseResult(null),
  })

  const createMut = useMutation({
    mutationFn: () =>
      api.post("/signal-rules", {
        name: name.trim(),
        description: description.trim() || null,
        weight: Number(weight) || 1,
        type: type.trim() || null,
        expression: parsed.value,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signal-rules"] })
      onOpenChange(false)
    },
    onError: (err) => setSaveError(friendlyError(err)),
  })

  const updateMut = useMutation({
    mutationFn: () =>
      api.patch(`/signal-rules/${rule.id}`, {
        name: name.trim(),
        description: description.trim() || null,
        weight: Number(weight) || 1,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signal-rules"] })
      onOpenChange(false)
    },
    onError: (err) => setSaveError(friendlyError(err)),
  })

  const saving = createMut.isPending || updateMut.isPending
  const canSave = isEdit
    ? name.trim().length > 0 && !saving
    : name.trim().length > 0 && parsed.ok && settled && !!validation?.valid && !saving

  function handleSave() {
    setSaveError(null)
    ;(isEdit ? updateMut : createMut).mutate()
  }

  const canPreviewUniverse = parsed.ok && settled && !!validation?.valid && !universePending

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
              <DialogPrimitive.Title className="text-base font-semibold">
                {isEdit ? `Edit ${rule?.name}` : "New signal"}
              </DialogPrimitive.Title>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isEdit
                  ? "The expression is locked — clone the signal to change its logic."
                  : "A named boolean rule over indicator variables. It scores every ticker on the next screener run."}
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
            {/* ---------------- Form ---------------- */}
            <div className="space-y-3.5">
              <Field label="Name">
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Strong oversold"
                  aria-label="Signal name"
                  autoFocus
                />
              </Field>

              <Field label="Description" hint="Optional — shown in tooltips.">
                <input
                  className={inputClass}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this signal capture?"
                  aria-label="Signal description"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Weight" hint="Points this adds to the score.">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className={cn(inputClass, "tabular-nums")}
                    value={weight}
                    onChange={(e) => setWeight(e.target.value === "" ? "" : Number(e.target.value))}
                    aria-label="Signal weight"
                  />
                </Field>
                <Field label="Type" hint="Optional family tag.">
                  <input
                    className={inputClass}
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    placeholder="rsi, macd, …"
                    aria-label="Signal type"
                  />
                </Field>
              </div>

              <Field
                label={
                  <span className="inline-flex items-center gap-1.5">
                    Expression (JsonLogic)
                    {isEdit && <Lock size={11} aria-hidden="true" />}
                  </span>
                }
                hint={
                  isEdit
                    ? "Locked once created — clone to change the logic."
                    : 'e.g. {"<": [{"var": "rsi_14"}, 30]}'
                }
              >
                <textarea
                  className={cn(
                    inputClass,
                    "font-mono text-xs leading-relaxed resize-y min-h-[7rem]",
                    isEdit && "opacity-70 cursor-not-allowed"
                  )}
                  value={exprText}
                  onChange={(e) => setExprText(e.target.value)}
                  readOnly={isEdit}
                  spellCheck={false}
                  aria-label="Expression JSON"
                />
              </Field>
            </div>

            {/* ---------------- Live feedback ---------------- */}
            <div className="space-y-3">
              {/* Validation */}
              <ValidationPanel parsed={parsed} settled={settled} validation={validation} />

              {/* Single-symbol preview */}
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Preview on</span>
                  <div className="w-32">
                    <Combobox
                      value={previewSymbol}
                      onChange={(v) => setPreviewSymbol(v.toUpperCase())}
                      options={symbols}
                      placeholder="Symbol"
                      aria-label="Preview symbol"
                    />
                  </div>
                </div>
                {validation?.valid && preview ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-sm">
                      {preview.value ? (
                        <>
                          <Check size={14} className="text-green-500" aria-hidden="true" />
                          <span className="text-green-600 dark:text-green-400 font-medium">
                            Fires on {preview.symbol}
                          </span>
                        </>
                      ) : (
                        <>
                          <X size={14} className="text-muted-foreground" aria-hidden="true" />
                          <span className="text-muted-foreground">Doesn&rsquo;t fire on {preview.symbol}</span>
                        </>
                      )}
                    </div>
                    {Object.keys(preview.features_used || {}).length > 0 && (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
                        {Object.entries(preview.features_used).map(([k, v]) => (
                          <span key={k}>
                            {k} = <span className="text-foreground">{fmtNum(v)}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Enter a valid expression to preview against a single symbol.
                  </p>
                )}
              </div>

              {/* Universe preview */}
              <div className="rounded-lg border border-border p-3 space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5"
                  onClick={() => runUniverse()}
                  disabled={!canPreviewUniverse}
                >
                  <Globe size={13} aria-hidden="true" />
                  {universePending ? "Scanning…" : "Preview across universe"}
                </Button>
                {universeResult && (
                  <div className="space-y-1.5">
                    <p className="text-sm">
                      Matches{" "}
                      <span className="font-semibold">{universeResult.match_count}</span> of{" "}
                      <span className="font-semibold">{universeResult.evaluated_count}</span> tickers
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Against the latest cached data ({universeResult.universe_count} in the Pass-1 universe).
                    </p>
                    {universeResult.matched.length > 0 && (
                      <div className="max-h-32 overflow-y-auto rounded border border-border/60 divide-y divide-border/40">
                        {universeResult.matched.map((sym) => (
                          <div key={sym} className="flex items-center justify-between gap-2 px-2 py-1 text-[11px]">
                            <span className="font-mono">{sym}</span>
                            <span className="text-muted-foreground tabular-nums truncate">
                              {Object.entries(universeResult.values[sym] || {})
                                .map(([k, v]) => `${k}=${fmtNum(v)}`)
                                .join("  ")}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-5 pt-4 border-t border-border flex items-center justify-end gap-2">
            {saveError && (
              <span role="alert" className="text-xs text-destructive mr-auto">{saveError}</span>
            )}
            <DialogPrimitive.Close asChild>
              <Button variant="outline" size="sm" disabled={saving}>Cancel</Button>
            </DialogPrimitive.Close>
            <Button size="sm" onClick={handleSave} disabled={!canSave}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create signal"}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

// ---------------------------------------------------------------------------
// Validation panel — parse error / errors / the formatted human string
// ---------------------------------------------------------------------------

function ValidationPanel({ parsed, settled, validation }) {
  if (parsed.empty) {
    return (
      <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[11px] text-muted-foreground">
        Write an expression to see how it reads.
      </div>
    )
  }
  if (!parsed.ok) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
        Invalid JSON: {parsed.error}
      </div>
    )
  }
  if (!settled || !validation) {
    return (
      <div className="rounded-lg border border-border px-3 py-2.5 text-[11px] text-muted-foreground animate-pulse">
        Checking…
      </div>
    )
  }
  if (!validation.valid) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-xs text-destructive space-y-1">
        <div className="flex items-center gap-1.5 font-medium">
          <AlertTriangle size={13} aria-hidden="true" /> Invalid expression
        </div>
        <ul className="list-disc list-inside space-y-0.5">
          {validation.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2.5 text-sm">
      <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 font-medium">
        <Check size={14} aria-hidden="true" /> Valid
      </div>
      <p className="mt-1 text-foreground">
        Reads as: <span className="font-medium">{validation.formatted}</span>
      </p>
    </div>
  )
}
