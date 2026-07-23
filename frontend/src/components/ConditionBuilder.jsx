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

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const selectClass =
  "rounded-md border border-input bg-background px-2 py-1.5 text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
const numClass =
  "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular-nums " +
  "focus:outline-none focus:ring-2 focus:ring-ring"

function VariableSelect({ value, onChange, variables, groups, ariaLabel }) {
  return (
    <select className={cn(selectClass, "min-w-0 flex-1")} value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}>
      <option value="">— variable —</option>
      {groups.map((group) => (
        <optgroup key={group} label={group}>
          {variables.filter((v) => v.group === group).map((v) => (
            <option key={v.name} value={v.name}>{v.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

/**
 * Structured "match ALL/ANY of these conditions" editor (M19b.3). Emits a
 * JsonLogic object (or null) via onChange; the parent owns the canonical text.
 */
export default function ConditionBuilder({ seed, variables = [], onChange }) {
  const groups = useMemo(
    () => [...new Set(variables.map((v) => v.group))],
    [variables]
  )
  const typeOf = useMemo(() => {
    const m = {}
    for (const v of variables) m[v.name] = v.type
    return m
  }, [variables])

  const [combinator, setCombinator] = useState(seed?.combinator ?? "all")
  const [conditions, setConditions] = useState(
    seed?.conditions?.length ? seed.conditions : [blankCondition()]
  )

  // Keep the parent's expression in sync with the structured state.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    onChangeRef.current(buildLogic(combinator, conditions))
  }, [combinator, conditions])

  function updateCondition(id, patch) {
    setConditions((cs) => cs.map((c) => (c._id === id ? { ...c, ...patch } : c)))
  }
  function addCondition() {
    setConditions((cs) => [...cs, blankCondition()])
  }
  function removeCondition(id) {
    setConditions((cs) => (cs.length === 1 ? [blankCondition()] : cs.filter((c) => c._id !== id)))
  }

  function opsFor(variable) {
    return typeOf[variable] === "boolean" ? BOOLEAN_OPS : NUMBER_OPS
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Match</span>
        <select
          className={selectClass}
          value={combinator}
          onChange={(e) => setCombinator(e.target.value)}
          aria-label="Match combinator"
        >
          <option value="all">all</option>
          <option value="any">any</option>
        </select>
        <span className="text-muted-foreground">of these conditions:</span>
      </div>

      <div className="space-y-2">
        {conditions.map((c, i) => {
          const ops = opsFor(c.variable)
          const showRhsKind = COMPARISONS.includes(c.operator)
          return (
            <div key={c._id} className="flex items-start gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
                <VariableSelect
                  value={c.variable}
                  onChange={(v) => updateCondition(c._id, { variable: v, operator: "" })}
                  variables={variables}
                  groups={groups}
                  ariaLabel={`Condition ${i + 1} variable`}
                />
                <select
                  className={selectClass}
                  value={c.operator}
                  onChange={(e) => updateCondition(c._id, { operator: e.target.value })}
                  aria-label={`Condition ${i + 1} operator`}
                  disabled={!c.variable}
                >
                  <option value="">— is —</option>
                  {ops.map((op) => (
                    <option key={op} value={op}>{OP_LABELS[op]}</option>
                  ))}
                </select>

                {c.operator === "between" && (
                  <div className="flex items-center gap-1">
                    <input
                      type="number" className={cn(numClass, "w-20")} value={c.low}
                      onChange={(e) => updateCondition(c._id, { low: e.target.value })}
                      aria-label={`Condition ${i + 1} low`} placeholder="low"
                    />
                    <span className="text-muted-foreground text-xs">and</span>
                    <input
                      type="number" className={cn(numClass, "w-20")} value={c.high}
                      onChange={(e) => updateCondition(c._id, { high: e.target.value })}
                      aria-label={`Condition ${i + 1} high`} placeholder="high"
                    />
                  </div>
                )}

                {showRhsKind && (
                  <>
                    <select
                      className={selectClass}
                      value={c.rhsKind}
                      onChange={(e) => updateCondition(c._id, { rhsKind: e.target.value })}
                      aria-label={`Condition ${i + 1} compare to`}
                    >
                      <option value="value">a value</option>
                      <option value="var">a variable</option>
                    </select>
                    {c.rhsKind === "var" ? (
                      <VariableSelect
                        value={c.rhsVariable}
                        onChange={(v) => updateCondition(c._id, { rhsVariable: v })}
                        variables={variables}
                        groups={groups}
                        ariaLabel={`Condition ${i + 1} value variable`}
                      />
                    ) : (
                      <input
                        type="number" className={cn(numClass, "w-24")} value={c.value}
                        onChange={(e) => updateCondition(c._id, { value: e.target.value })}
                        aria-label={`Condition ${i + 1} value`} placeholder="value"
                      />
                    )}
                  </>
                )}
              </div>

              <button
                type="button"
                className="mt-1.5 rounded p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                onClick={() => removeCondition(c._id)}
                aria-label={`Remove condition ${i + 1}`}
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>

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
