import { useState, useEffect, useMemo, useRef } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { X, Check, AlertTriangle, Globe, Lock, Blocks, Code2, Pencil, ArrowLeft } from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Combobox, Field, TextInput, NumberInput, Textarea } from "@/components/ui/form"
import { useDebounce } from "@/lib/useDebounce"
import ConditionBuilder, { logicToConditions, ConditionSummary } from "@/components/ConditionBuilder"
import { cn } from "@/lib/utils"
import { friendlyError } from "@/lib/signalRuleErrors"
import { numberError } from "@/lib/validate"

// Weight: whole points, at least 1 (the score is a sum of integer weights).
const WEIGHT_RULES = { required: true, integer: true, min: 1 }

const PREVIEW_SYMBOL_KEY = "signalPreviewSymbol"

function stringifyExpr(expr) {
  try {
    return JSON.stringify(expr ?? {}, null, 2)
  } catch {
    return ""
  }
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
 * Signal builder.
 *
 * Two views inside one modal:
 *   - details:    name / description / weight / type, a read-only rendering of
 *                 the expression, and the live checks.
 *   - expression: a full-width editor (visual builder, or raw JSON as the escape
 *                 hatch). Apply keeps the edits, Cancel restores what was there.
 *
 * Edit mode: the expression is immutable once created, so there is no editor
 * view — the user is pointed at Clone to change the logic.
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
  const [nameTouched, setNameTouched] = useState(false)
  const [type, setType] = useState("")
  const [exprText, setExprText] = useState("")
  const [previewSymbol, setPreviewSymbol] = useState(() => {
    try {
      return localStorage.getItem(PREVIEW_SYMBOL_KEY) || defaultSymbol
    } catch {
      return defaultSymbol
    }
  })
  const [saveError, setSaveError] = useState(null)
  const [universeResult, setUniverseResult] = useState(null)
  const [view, setView] = useState("details")               // "details" | "expression"
  const [editorMode, setEditorMode] = useState("builder")   // "builder" | "json"
  const [builderKey, setBuilderKey] = useState(0)
  const [incomplete, setIncomplete] = useState([])          // unfinished builder rows (1-based)
  const snapshot = useRef(null)                             // restored on Cancel

  // Variables for the builder's pickers and the summary's labels.
  const { data: variablesResp } = useQuery({
    queryKey: ["rule-variables"],
    queryFn: () => api.get("/rules/variables"),
    staleTime: Infinity,
    enabled: open,
  })
  const variables = variablesResp?.variables ?? []

  // Seed the form each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setSaveError(null)
    setUniverseResult(null)
    setView("details")
    setNameTouched(false)
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
    try {
      if (previewSymbol) localStorage.setItem(PREVIEW_SYMBOL_KEY, previewSymbol)
    } catch { /* storage unavailable — the picker still works */ }
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

  // Structured-builder seed + whether the current expression fits the builder.
  const builderSeed = useMemo(
    () => (parsed.ok ? logicToConditions(parsed.value) : null),
    [parsed]
  )
  const builderRepresentable = parsed.empty || builderSeed !== null

  function openEditor() {
    snapshot.current = exprText
    setIncomplete([])
    // Start in the builder unless the expression is too complex for it.
    setEditorMode(builderRepresentable ? "builder" : "json")
    setBuilderKey((k) => k + 1)   // remount so it reseeds from the current text
    setView("expression")
  }
  function applyEditor() {
    if (blockingIncomplete.length) return
    snapshot.current = null
    setView("details")
  }
  function cancelEditor() {
    if (snapshot.current !== null) setExprText(snapshot.current)
    snapshot.current = null
    setView("details")
  }
  // Unfinished rows only matter in the builder — JSON text is what it is.
  const blockingIncomplete = editorMode === "builder" ? incomplete : []

  function switchToBuilder() {
    if (!builderRepresentable) return
    setEditorMode("builder")
    setBuilderKey((k) => k + 1)
  }

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

  // Live validate — server owns the human-readable string + error list. No
  // keepPreviousData: while the current expression's validation is in flight,
  // `validation` must be undefined (→ "Checking…", Save disabled) rather than
  // showing the previous expression's stale "Valid".
  const { data: validation } = useQuery({
    queryKey: ["rule-validate", debouncedParsed],
    queryFn: () => api.post("/rules/validate", { rule: debouncedParsed }),
    enabled: open && !!debouncedParsed,
  })
  const isValid = parsed.ok && settled && !!validation?.valid

  // Single-symbol live preview (only when the rule is valid).
  const { data: preview } = useQuery({
    queryKey: ["rule-preview", debouncedParsed, previewSymbol],
    queryFn: () => api.post("/rules/preview", { rule: debouncedParsed, symbol: previewSymbol }),
    enabled: open && !!debouncedParsed && !!previewSymbol && !!validation?.valid,
    placeholderData: keepPreviousData,
  })

  // Full-universe preview — button-triggered, not per-keystroke. The result is
  // keyed to the exact text it was computed for and hidden once the expression
  // changes, so a stale "Matches N" never sits next to a different rule.
  const { mutate: runUniverse, isPending: universePending } = useMutation({
    mutationFn: (text) => api.post("/rules/preview-universe", { rule: JSON.parse(text) }),
    onSuccess: (res, text) => setUniverseResult({ forText: text, res }),
    onError: () => setUniverseResult(null),
  })
  const universeShown = universeResult?.forText === exprText ? universeResult.res : null

  const wError = numberError(weight, WEIGHT_RULES)
  // "Required" appears once you've left the field, not the moment the dialog opens.
  const nameError = nameTouched && !name.trim() ? "Required" : null

  const createMut = useMutation({
    mutationFn: () =>
      api.post("/signal-rules", {
        name: name.trim(),
        description: description.trim() || null,
        weight,
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
        type: type.trim() || null,
        weight,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signal-rules"] })
      onOpenChange(false)
    },
    onError: (err) => setSaveError(friendlyError(err)),
  })

  const saving = createMut.isPending || updateMut.isPending
  const fieldsOk = name.trim().length > 0 && !wError && !saving
  const canSave = isEdit ? fieldsOk : fieldsOk && isValid

  function handleSave() {
    setSaveError(null)
    ;(isEdit ? updateMut : createMut).mutate()
  }

  const inEditor = view === "expression"

  const livePanels = (
    <>
      <ValidationPanel parsed={parsed} settled={settled} validation={validation} />
      <PreviewPanel
        symbols={symbols}
        previewSymbol={previewSymbol}
        setPreviewSymbol={setPreviewSymbol}
        validation={validation}
        preview={preview}
      />
      <UniversePanel
        canRun={isValid && !universePending}
        pending={universePending}
        onRun={() => runUniverse(exprText)}
        result={universeShown}
      />
    </>
  )

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2",
            inEditor ? "max-w-4xl" : "max-w-3xl",
            "max-h-[92vh] overflow-y-auto transition-[max-width] duration-200",
            "rounded-lg border border-border bg-background p-5 shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          )}
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            // Escape inside an open builder token just closes that token.
            if (e.target?.closest?.("[data-token-editing]")) {
              e.preventDefault()
              return
            }
            // In the expression editor Escape never closes the dialog, and never
            // throws work away: it only backs out when nothing has changed, and
            // not at all when it came from a field/picker (e.g. closing the
            // preview symbol list). Discarding edits takes an explicit Cancel.
            if (inEditor) {
              e.preventDefault()
              const fromControl = e.target?.closest?.('input, textarea, select, [role="combobox"], [role="listbox"]')
              if (!fromControl && exprText === snapshot.current) cancelEditor()
            }
          }}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="min-w-0">
              {inEditor && (
                <button
                  type="button"
                  onClick={cancelEditor}
                  className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft size={12} aria-hidden="true" /> Back to signal details
                </button>
              )}
              <DialogPrimitive.Title className="text-base font-semibold truncate">
                {inEditor
                  ? `Expression${name.trim() ? ` — ${name.trim()}` : ""}`
                  : isEdit ? `Edit ${rule?.name}` : "New signal"}
              </DialogPrimitive.Title>
              <p className="text-xs text-muted-foreground mt-0.5">
                {inEditor
                  ? "Define when this signal fires. Apply to keep your changes, Cancel to discard them."
                  : isEdit
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

          {inEditor ? (
            /* ---------------- Expression editor view ---------------- */
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {editorMode === "builder" ? "Visual builder" : "Raw JsonLogic"}
                </span>
                <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={switchToBuilder}
                    disabled={!builderRepresentable}
                    title={builderRepresentable ? undefined : "This expression is too complex for the visual builder — edit it as JSON."}
                    className={cn(
                      "px-2 py-1 rounded inline-flex items-center gap-1 transition-colors",
                      editorMode === "builder" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                      !builderRepresentable && "opacity-40 cursor-not-allowed"
                    )}
                  >
                    <Blocks size={12} aria-hidden="true" /> Builder
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditorMode("json")}
                    className={cn(
                      "px-2 py-1 rounded inline-flex items-center gap-1 transition-colors",
                      editorMode === "json" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Code2 size={12} aria-hidden="true" /> JSON
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4 min-h-[10rem]">
                {editorMode === "builder" ? (
                  variables.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">Loading variables…</p>
                  ) : (
                    <ConditionBuilder
                      key={builderKey}
                      seed={builderSeed}
                      variables={variables}
                      onChange={(obj, meta) => {
                        setExprText(obj ? JSON.stringify(obj, null, 2) : "")
                        setIncomplete(meta?.incomplete ?? [])
                      }}
                    />
                  )
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <Textarea
                      className="font-mono text-xs min-h-[12rem]"
                      value={exprText}
                      onChange={(e) => setExprText(e.target.value)}
                      spellCheck={false}
                      aria-label="Expression JSON"
                      placeholder='{"<": [{"var": "rsi_14"}, 30]}'
                    />
                    <span className="text-[11px] text-muted-foreground/70">
                      Raw JsonLogic — the escape hatch for anything the builder can&rsquo;t express.
                    </span>
                  </div>
                )}
              </div>

              <div className="grid md:grid-cols-3 gap-3 items-start">{livePanels}</div>
            </div>
          ) : (
            /* ---------------- Details view ---------------- */
            // Fields lock while a save is in flight (dialogs commit as one unit).
            <fieldset disabled={saving} className="contents">
            <div className="grid md:grid-cols-5 gap-5">
              <div className="md:col-span-3 space-y-3.5">
                <Field label="Name" error={nameError}>
                  <TextInput
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => setNameTouched(true)}
                    placeholder="e.g. Strong oversold"
                    aria-label="Signal name"
                    autoFocus
                  />
                </Field>

                <Field label="Description" hint="Optional — shown in tooltips.">
                  <TextInput
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What does this signal capture?"
                    aria-label="Signal description"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Weight" hint="Points this adds to the score.">
                    <NumberInput
                      value={weight}
                      onChange={setWeight}
                      {...WEIGHT_RULES}
                      aria-label="Signal weight"
                    />
                  </Field>
                  <Field label="Type" hint="Optional family tag.">
                    <TextInput
                      value={type}
                      onChange={(e) => setType(e.target.value)}
                      placeholder="rsi, macd, …"
                      aria-label="Signal type"
                    />
                  </Field>
                </div>

                {/* Expression — read-only rendering; editing happens in its own view */}
                <div className="rounded-lg border border-border p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1.5">
                      Expression
                      {isEdit && <Lock size={11} aria-hidden="true" />}
                    </span>
                    {!isEdit && (
                      <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={openEditor}>
                        <Pencil size={12} aria-hidden="true" />
                        {parsed.empty ? "Build expression" : "Edit expression"}
                      </Button>
                    )}
                  </div>
                  <ExpressionDisplay
                    parsed={parsed}
                    representable={builderSeed !== null}
                    variables={variables}
                    formatted={validation?.formatted}
                    showJson={isEdit}
                  />
                  {isEdit && (
                    <span className="block text-[11px] text-muted-foreground/70">
                      Locked once created — clone to change the logic.
                    </span>
                  )}
                </div>
              </div>

              <div className="md:col-span-2 space-y-3">{livePanels}</div>
            </div>
            </fieldset>
          )}

          {/* Footer */}
          <div className="mt-5 pt-4 border-t border-border flex items-center justify-end gap-2">
            {inEditor ? (
              <>
                {blockingIncomplete.length > 0 && (
                  <span role="status" className="text-xs text-amber-600 dark:text-amber-400 mr-auto">
                    {blockingIncomplete.length === 1
                      ? `Condition ${blockingIncomplete[0]} is incomplete`
                      : `Conditions ${blockingIncomplete.join(", ")} are incomplete`}{" "}
                    — finish or remove {blockingIncomplete.length === 1 ? "it" : "them"} to apply.
                  </span>
                )}
                <Button variant="outline" size="sm" onClick={cancelEditor}>Cancel</Button>
                <Button size="sm" onClick={applyEditor} disabled={blockingIncomplete.length > 0}>
                  Apply expression
                </Button>
              </>
            ) : (
              <>
                {saveError && (
                  <span role="alert" className="text-xs text-destructive mr-auto">{saveError}</span>
                )}
                <DialogPrimitive.Close asChild>
                  <Button variant="outline" size="sm" disabled={saving}>Cancel</Button>
                </DialogPrimitive.Close>
                <Button size="sm" onClick={handleSave} disabled={!canSave && !saving} loading={saving}>
                  {saving ? "Saving…" : isEdit ? "Save changes" : "Create signal"}
                </Button>
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

// ---------------------------------------------------------------------------
// Expression display (details view) — the builder's visual language, read-only
// ---------------------------------------------------------------------------

function ExpressionDisplay({ parsed, representable, variables, formatted, showJson }) {
  if (parsed.empty) {
    return (
      <p className="text-xs text-muted-foreground">
        No conditions yet — build an expression to define when this signal fires.
      </p>
    )
  }
  if (!parsed.ok) {
    return <p className="text-xs text-destructive">Invalid JSON — open the editor to fix it.</p>
  }
  return (
    <div className="space-y-2">
      {representable ? (
        <ConditionSummary expr={parsed.value} variables={variables} />
      ) : (
        <div className="space-y-1">
          <p className="text-sm">{formatted || "Custom JSON expression"}</p>
          <p className="text-[11px] text-muted-foreground">
            Too complex for the visual builder — edited as JSON.
          </p>
        </div>
      )}
      {(showJson || !representable) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">JSON</summary>
          <pre className="mt-1.5 max-h-48 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
            {JSON.stringify(parsed.value, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Live feedback panels
// ---------------------------------------------------------------------------

function PreviewPanel({ symbols, previewSymbol, setPreviewSymbol, validation, preview }) {
  return (
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
  )
}

function UniversePanel({ canRun, pending, onRun, result }) {
  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <Button
        variant="outline"
        size="sm"
        className="w-full gap-1.5"
        onClick={onRun}
        disabled={!canRun}
      >
        <Globe size={13} aria-hidden="true" />
        {pending ? "Scanning…" : "Preview across universe"}
      </Button>
      {result && (
        <div className="space-y-1.5">
          <p className="text-sm">
            Matches <span className="font-semibold">{result.match_count}</span> of{" "}
            <span className="font-semibold">{result.evaluated_count}</span> tickers
          </p>
          <p className="text-[11px] text-muted-foreground">
            Against the latest cached data ({result.universe_count} in the Pass-1 universe).
          </p>
          {result.matched.length > 0 && (
            <div className="max-h-32 overflow-y-auto rounded border border-border/60 divide-y divide-border/40">
              {result.matched.map((sym) => (
                <div key={sym} className="flex items-center justify-between gap-2 px-2 py-1 text-[11px]">
                  <span className="font-mono">{sym}</span>
                  <span className="text-muted-foreground tabular-nums truncate">
                    {Object.entries(result.values[sym] || {})
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
