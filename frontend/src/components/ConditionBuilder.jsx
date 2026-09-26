import { useState, useEffect, useMemo, useRef } from "react"
import { Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// JsonLogic <-> structured conditions
//
// The builder edits a flat "match ALL/ANY of these conditions" shape. Anything
// more complex (nested groups, arithmetic) round-trips through the raw-JSON mode
// instead — `logicToConditions` returns null for those so the dialog can tell.
// ---------------------------------------------------------------------------

const COMPARISONS = ["<", "<=", ">", ">=", "==", "!="]

export const OP_LABELS = {
  "<": "<", "<=": "≤", ">": ">", ">=": "≥", "==": "=", "!=": "≠",
  between: "between", is_true: "is true", is_false: "is false",
}

const NUMBER_OPS = [...COMPARISONS, "between"]
const BOOLEAN_OPS = ["is_true", "is_false"]

const isVar = (x) => x && typeof x === "object" && typeof x.var === "string"
const isNum = (x) => typeof x === "number"

function flip(op) {
  return { "<": ">", "<=": ">=", ">": "<", ">=": "<=", "==": "==", "!=": "!=" }[op]
}

let _seq = 0
const newId = () => ++_seq

function blankCondition() {
  return { _id: newId(), variable: "", operator: "", rhsKind: "value", value: "", rhsVariable: "", low: "", high: "" }
}

function conditionComplete(c) {
  if (!c.variable || !c.operator) return false
  if (c.operator === "is_true" || c.operator === "is_false") return true
  if (c.operator === "between") return c.low !== "" && c.high !== ""
  return c.rhsKind === "var" ? !!c.rhsVariable : c.value !== ""
}

function conditionToLogic(c) {
  const lhs = { var: c.variable }
  if (c.operator === "is_true") return lhs
  if (c.operator === "is_false") return { "!": [lhs] }
  if (c.operator === "between") return { "<=": [Number(c.low), lhs, Number(c.high)] }
  const rhs = c.rhsKind === "var" ? { var: c.rhsVariable } : Number(c.value)
  return { [c.operator]: [lhs, rhs] }
}

/** Build a JsonLogic object from the current conditions, or null if none complete. */
export function buildLogic(combinator, conditions) {
  const parts = conditions.filter(conditionComplete).map(conditionToLogic)
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]
  return { [combinator === "all" ? "and" : "or"]: parts }
}

function parseCondition(node) {
  if (!node || typeof node !== "object") return null
  if (typeof node.var === "string" && Object.keys(node).length === 1) {
    return { ...blankCondition(), variable: node.var, operator: "is_true" }
  }
  if (Array.isArray(node["!"]) && node["!"].length === 1 && isVar(node["!"][0])) {
    return { ...blankCondition(), variable: node["!"][0].var, operator: "is_false" }
  }
  for (const op of COMPARISONS) {
    if (!Array.isArray(node[op])) continue
    const args = node[op]
    // between: <= with [low, {var}, high]
    if (op === "<=" && args.length === 3 && isNum(args[0]) && isVar(args[1]) && isNum(args[2])) {
      return { ...blankCondition(), variable: args[1].var, operator: "between", low: args[0], high: args[2] }
    }
    if (args.length !== 2) return null
    const [a, b] = args
    // Only a variable LHS with a variable- or number-literal RHS is representable.
    // An arithmetic/string/bool RHS (e.g. {"*": [...]}) must fall through to null so
    // the dialog keeps it in JSON mode instead of mangling it to `var > null`.
    if (isVar(a) && (isVar(b) || isNum(b))) {
      return {
        ...blankCondition(), variable: a.var, operator: op,
        rhsKind: isVar(b) ? "var" : "value",
        value: isVar(b) ? "" : b, rhsVariable: isVar(b) ? b.var : "",
      }
    }
    if (isNum(a) && isVar(b)) {
      return { ...blankCondition(), variable: b.var, operator: flip(op), rhsKind: "value", value: a }
    }
    return null
  }
  return null
}

/** Parse JsonLogic into {combinator, conditions}, or null if not representable. */
export function logicToConditions(expr) {
  if (!expr || typeof expr !== "object") return null
  let combinator = "all"
  let items
  if (Array.isArray(expr.and)) { combinator = "all"; items = expr.and }
  else if (Array.isArray(expr.or)) { combinator = "any"; items = expr.or }
  else { items = [expr] }
  const conditions = []
  for (const item of items) {
    const c = parseCondition(item)
    if (!c) return null
    conditions.push(c)
  }
  return { combinator, conditions }
}

/** The next field a user needs to fill for this condition, or null when complete. */
function nextEmptyField(c) {
  if (!c.variable) return "variable"
  if (!c.operator) return "operator"
  if (c.operator === "between") {
    if (c.low === "") return "low"
    if (c.high === "") return "high"
    return null
  }
  if (COMPARISONS.includes(c.operator)) {
    const filled = c.rhsKind === "var" ? !!c.rhsVariable : c.value !== ""
    return filled ? null : "rhs"
  }
  return null
}

/**
 * 1-based positions of conditions that are started but unfinished. buildLogic
 * drops them from the expression, so the caller must not let the user commit
 * while any exist (an untouched blank row is harmless and not counted).
 */
function incompleteConditions(conditions) {
  const out = []
  conditions.forEach((c, i) => {
    if (c.variable && nextEmptyField(c) !== null) out.push(i + 1)
  })
  return out
}

// ---------------------------------------------------------------------------
// UI
//
// Every slot in a condition is a "token": at rest it reads as plain text
// ("RSI (14)  <  30"); clicking it swaps in the real control, and committing
// swaps it back. That keeps a multi-condition rule legible instead of a wall of
// half-truncated dropdowns. New conditions auto-advance through their empty
// slots so building one is a quick pick → pick → type.
// ---------------------------------------------------------------------------

const controlClass =
  "rounded-md border border-input bg-background px-2 py-1 text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-ring"

const tokenBase = "inline-flex items-center rounded-md px-2 py-0.5 text-sm whitespace-nowrap"

const TOKEN_TONES = {
  variable: "bg-primary/10 text-primary font-medium",
  operator: "bg-muted text-foreground font-mono",
  value: "bg-muted text-foreground tabular-nums",
  combinator: "bg-muted text-foreground font-medium",
}

/** A value at rest; click to edit. `children` is the editing control. */
function Token({ kind, text, placeholder, editing, onEdit, onDone, readOnly, ariaLabel, children }) {
  const buttonRef = useRef(null)
  const wasEditing = useRef(editing)
  // When this token closes and its control took focus with it (Enter/Escape, or a
  // commit), hand focus back to the pill so keyboard users keep their place
  // instead of being dumped at the top of the dialog. A click elsewhere already
  // moved focus, so leave it alone then; a successor token that auto-opens
  // focuses itself afterwards and wins.
  useEffect(() => {
    if (wasEditing.current && !editing) {
      const active = document.activeElement
      if (!active || active === document.body || active.getAttribute("role") === "dialog") {
        buttonRef.current?.focus()
      }
    }
    wasEditing.current = editing
  }, [editing])

  const empty = text == null || text === ""
  const body = empty ? placeholder : text
  const cls = cn(
    tokenBase,
    empty ? "border border-dashed border-muted-foreground/40 text-muted-foreground italic" : TOKEN_TONES[kind]
  )
  if (readOnly) return <span className={cls}>{body}</span>
  if (editing) {
    return (
      <span
        className="inline-flex items-center gap-1"
        data-token-editing=""
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) onDone(false)
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" || e.key === "Enter") {
            e.preventDefault()
            onDone(e.key === "Enter")
          }
        }}
      >
        {children}
      </span>
    )
  }
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onEdit}
      aria-label={ariaLabel}
      className={cn(cls, "cursor-pointer hover:ring-1 hover:ring-ring/60 transition-shadow")}
    >
      {body}
    </button>
  )
}

/** Focus a control on mount and, for selects, try to pop its option list open. */
function useAutoOpen() {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    if (el.tagName === "SELECT") {
      try { el.showPicker?.() } catch { /* needs a user gesture; focus alone is fine */ }
    }
  }, [])
  return ref
}

function AutoSelect({ className, children, ...props }) {
  const ref = useAutoOpen()
  return <select ref={ref} className={cn(controlClass, "cursor-pointer", className)} {...props}>{children}</select>
}

function AutoNumber({ className, ...props }) {
  const ref = useAutoOpen()
  return <input ref={ref} type="number" className={cn(controlClass, "w-24 tabular-nums", className)} {...props} />
}

function VariableOptions({ variables, groups }) {
  return (
    <>
      <option value="">— variable —</option>
      {groups.map((group) => (
        <optgroup key={group} label={group}>
          {variables.filter((v) => v.group === group).map((v) => (
            <option key={v.name} value={v.name}>{v.label}</option>
          ))}
        </optgroup>
      ))}
    </>
  )
}

/**
 * Renders a combinator + condition list. Shared by the editable builder and the
 * read-only summary so a rule looks identical in both places.
 */
function ConditionList({
  combinator, conditions, variables, readOnly = false,
  editing = null, setEditing = () => {}, onCombinator, onUpdate, onRemove,
}) {
  const groups = useMemo(() => [...new Set(variables.map((v) => v.group))], [variables])
  const byName = useMemo(() => Object.fromEntries(variables.map((v) => [v.name, v])), [variables])
  const labelOf = (name) => byName[name]?.label ?? name
  const opsFor = (name) => (byName[name]?.type === "boolean" ? BOOLEAN_OPS : NUMBER_OPS)
  const isEditing = (id, field) => !readOnly && editing?.id === id && editing?.field === field
  const joiner = combinator === "all" ? "and" : "or"

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {conditions.length > 1 ? (
          <>
            <span>Fires when</span>
            <Token
              kind="combinator" readOnly={readOnly}
              text={combinator}
              editing={isEditing("root", "combinator")}
              onEdit={() => setEditing({ id: "root", field: "combinator" })}
              onDone={() => setEditing((cur) => (cur?.id === "root" ? null : cur))}
              ariaLabel={`Match combinator: ${combinator}`}
            >
              <AutoSelect
                value={combinator}
                onChange={(e) => { onCombinator(e.target.value); setEditing(null) }}
                aria-label="Match combinator"
              >
                <option value="all">all</option>
                <option value="any">any</option>
              </AutoSelect>
            </Token>
            <span>of these are true:</span>
          </>
        ) : (
          <span>Fires when:</span>
        )}
      </div>

      <ol className="space-y-1.5">
        {conditions.map((c, i) => {
          const n = i + 1
          // Enter moves on to the next empty slot; blur/Escape just closes. Only
          // acts if this token is still the open one — a late blur from a control
          // that just committed (and advanced) must not close its successor.
          const done = (field) => (advance) => {
            setEditing((cur) => {
              if (cur?.id !== c._id || cur?.field !== field) return cur
              const next = advance ? nextEmptyField(c) : null
              return next && next !== field ? { id: c._id, field: next } : null
            })
          }
          // A committed pick (select change) always advances.
          const commit = (patch) => {
            onUpdate(c._id, patch)
            const next = nextEmptyField({ ...c, ...patch })
            setEditing(next ? { id: c._id, field: next } : null)
          }
          const incomplete = nextEmptyField(c) !== null
          const rhsText = c.rhsKind === "var"
            ? (c.rhsVariable ? labelOf(c.rhsVariable) : "")
            : (c.value === "" ? "" : String(c.value))
          return (
            <li key={c._id}>
              {i > 0 && (
                <div className="pl-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {joiner}
                </div>
              )}
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2 py-1.5",
                  incomplete && !readOnly ? "border-dashed border-border" : "border-border/60 bg-muted/20"
                )}
              >
                <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
                  <Token
                    kind="variable" readOnly={readOnly}
                    text={c.variable ? labelOf(c.variable) : ""}
                    placeholder="variable"
                    editing={isEditing(c._id, "variable")}
                    onEdit={() => setEditing({ id: c._id, field: "variable" })}
                    onDone={done("variable")}
                    ariaLabel={`Condition ${n} variable: ${c.variable ? labelOf(c.variable) : "not set"}`}
                  >
                    <AutoSelect
                      value={c.variable}
                      onChange={(e) => {
                        const v = e.target.value
                        // Switching bool <-> number invalidates the operator.
                        const keepOp = c.operator && opsFor(v).includes(c.operator)
                        commit({ variable: v, operator: keepOp ? c.operator : "" })
                      }}
                      aria-label={`Condition ${n} variable`}
                    >
                      <VariableOptions variables={variables} groups={groups} />
                    </AutoSelect>
                  </Token>

                  {c.variable && (
                    <Token
                      kind="operator" readOnly={readOnly}
                      text={c.operator ? OP_LABELS[c.operator] : ""}
                      placeholder="is…"
                      editing={isEditing(c._id, "operator")}
                      onEdit={() => setEditing({ id: c._id, field: "operator" })}
                      onDone={done("operator")}
                      ariaLabel={`Condition ${n} operator: ${c.operator ? OP_LABELS[c.operator] : "not set"}`}
                    >
                      <AutoSelect
                        value={c.operator}
                        onChange={(e) => commit({ operator: e.target.value })}
                        aria-label={`Condition ${n} operator`}
                      >
                        <option value="">— is —</option>
                        {opsFor(c.variable).map((op) => (
                          <option key={op} value={op}>{OP_LABELS[op]}</option>
                        ))}
                      </AutoSelect>
                    </Token>
                  )}

                  {c.operator === "between" && (
                    <>
                      <Token
                        kind="value" readOnly={readOnly}
                        text={c.low === "" ? "" : String(c.low)} placeholder="low"
                        editing={isEditing(c._id, "low")}
                        onEdit={() => setEditing({ id: c._id, field: "low" })}
                        onDone={done("low")}
                        ariaLabel={`Condition ${n} low: ${c.low === "" ? "not set" : c.low}`}
                      >
                        <AutoNumber
                          value={c.low}
                          onChange={(e) => onUpdate(c._id, { low: e.target.value })}
                          aria-label={`Condition ${n} low`} placeholder="low"
                        />
                      </Token>
                      <span className="text-xs text-muted-foreground">and</span>
                      <Token
                        kind="value" readOnly={readOnly}
                        text={c.high === "" ? "" : String(c.high)} placeholder="high"
                        editing={isEditing(c._id, "high")}
                        onEdit={() => setEditing({ id: c._id, field: "high" })}
                        onDone={done("high")}
                        ariaLabel={`Condition ${n} high: ${c.high === "" ? "not set" : c.high}`}
                      >
                        <AutoNumber
                          value={c.high}
                          onChange={(e) => onUpdate(c._id, { high: e.target.value })}
                          aria-label={`Condition ${n} high`} placeholder="high"
                        />
                      </Token>
                    </>
                  )}

                  {COMPARISONS.includes(c.operator) && (
                    <Token
                      kind={c.rhsKind === "var" ? "variable" : "value"}
                      readOnly={readOnly}
                      text={rhsText}
                      placeholder={c.rhsKind === "var" ? "variable" : "value"}
                      editing={isEditing(c._id, "rhs")}
                      onEdit={() => setEditing({ id: c._id, field: "rhs" })}
                      onDone={done("rhs")}
                      ariaLabel={`Condition ${n} compare to: ${rhsText || "not set"}`}
                    >
                      <span className="inline-flex rounded-md border border-border p-0.5 text-[11px]">
                        {[["value", "123"], ["var", "var"]].map(([kind, label]) => (
                          <button
                            key={kind}
                            type="button"
                            // Keep focus inside the editor so the token stays open.
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => onUpdate(c._id, { rhsKind: kind })}
                            aria-pressed={c.rhsKind === kind}
                            aria-label={`Condition ${n} compare to a ${kind === "var" ? "variable" : "number"}`}
                            className={cn(
                              "px-1.5 rounded",
                              c.rhsKind === kind ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </span>
                      {c.rhsKind === "var" ? (
                        <AutoSelect
                          key="var"
                          value={c.rhsVariable}
                          onChange={(e) => commit({ rhsVariable: e.target.value })}
                          aria-label={`Condition ${n} value variable`}
                        >
                          <VariableOptions variables={variables} groups={groups} />
                        </AutoSelect>
                      ) : (
                        <AutoNumber
                          key="num"
                          value={c.value}
                          onChange={(e) => onUpdate(c._id, { value: e.target.value })}
                          aria-label={`Condition ${n} value`} placeholder="value"
                        />
                      )}
                    </Token>
                  )}
                </div>

                {!readOnly && (
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                    onClick={() => onRemove(c._id)}
                    aria-label={`Remove condition ${n}`}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/**
 * Structured "match ALL/ANY of these conditions" editor (M19b.3). Emits a
 * JsonLogic object (or null) via onChange; the parent owns the canonical text.
 */
export default function ConditionBuilder({ seed, variables = [], onChange }) {
  const [combinator, setCombinator] = useState(seed?.combinator ?? "all")
  const [conditions, setConditions] = useState(
    seed?.conditions?.length ? seed.conditions : [blankCondition()]
  )
  // Which token is open. A fresh, empty builder opens straight onto its first slot.
  const [editing, setEditing] = useState(() =>
    seed?.conditions?.length ? null : { id: conditions[0]._id, field: "variable" }
  )

  // Keep the parent's expression in sync with the structured state.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    onChangeRef.current(buildLogic(combinator, conditions), {
      incomplete: incompleteConditions(conditions),
    })
  }, [combinator, conditions])

  function updateCondition(id, patch) {
    setConditions((cs) => cs.map((c) => (c._id === id ? { ...c, ...patch } : c)))
  }
  function addCondition() {
    const c = blankCondition()
    setConditions((cs) => [...cs, c])
    setEditing({ id: c._id, field: "variable" })
  }
  function removeCondition(id) {
    if (conditions.length === 1) {
      const c = blankCondition()
      setConditions([c])
      setEditing({ id: c._id, field: "variable" })
    } else {
      setConditions((cs) => cs.filter((c) => c._id !== id))
      setEditing(null)
    }
  }

  return (
    <div className="space-y-2.5">
      <ConditionList
        combinator={combinator}
        conditions={conditions}
        variables={variables}
        editing={editing}
        setEditing={setEditing}
        onCombinator={setCombinator}
        onUpdate={updateCondition}
        onRemove={removeCondition}
      />
      <button
        type="button"
        onClick={addCondition}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        <Plus size={13} aria-hidden="true" /> Add condition
      </button>
    </div>
  )
}

/**
 * Read-only rendering of an expression in the builder's visual language.
 * Renders nothing when the expression is too complex for the builder, so the
 * caller should check `logicToConditions(expr) !== null` and fall back to the
 * formatted string / JSON otherwise.
 */
export function ConditionSummary({ expr, variables = [] }) {
  const parsed = useMemo(() => logicToConditions(expr), [expr])
  if (!parsed) return null
  return (
    <ConditionList
      readOnly
      combinator={parsed.combinator}
      conditions={parsed.conditions}
      variables={variables}
    />
  )
}

