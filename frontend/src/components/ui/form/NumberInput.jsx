import { forwardRef, useCallback, useEffect, useRef, useState } from "react"
import { ChevronUp, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { decimalsOf, numberError } from "@/lib/validate"
import { controlClass, invalidClass } from "./styles"
import { useFieldControl, useReportFieldError } from "./fieldContext"

/**
 * Numeric entry that only accepts valid keystrokes.
 *
 * - Characters are filtered as you type or paste: no letters/exponents ever,
 *   no "." in `integer` fields, no "-" when `min >= 0`, no more than
 *   `maxDecimals` digits after the point.
 * - Range problems (below `min`, above `max`) are *not* blocked mid-typing —
 *   typing 15 with min 10 has to pass through 1 — they're reported to the
 *   enclosing <Field> as a short red hint instead.
 * - Partial states ("", "-", "1.") are kept while typing; the emitted value is
 *   `number | null`.
 * - Themed stepper buttons (hold to repeat) and ↑/↓ keys step by `step`,
 *   clamped to min/max. The scroll wheel never changes the value.
 */
export const NumberInput = forwardRef(function NumberInput(
  {
    value,
    onChange,
    integer = false,
    min,
    max,
    step,
    maxDecimals,
    required = false,
    prefix,
    suffix,
    stepper = true,
    invalid,
    id,
    className,        // wrapper (sizing)
    inputClassName,   // the <input> itself
    disabled,
    onBlur,
    onKeyDown,
    ...props
  },
  ref
) {
  const allowNegative = min == null || min < 0
  const decimals = integer ? 0 : maxDecimals
  const stepSize = step ?? (integer ? 1 : decimals != null ? 10 ** -decimals : 0.01)
  const pattern = buildPattern({ allowNegative, decimals })

  // The text being edited. Kept separately from `value` so partial input like
  // "1." or "-" survives re-renders; re-synced when `value` changes elsewhere.
  const [draft, setDraft] = useState(() => format(value))
  const [seen, setSeen] = useState(value)
  if (!Object.is(value, seen)) {
    setSeen(value)
    if (!Object.is(parse(draft), value ?? null)) setDraft(format(value))
  }

  const ownError = numberError(value ?? null, { required, integer, min, max, maxDecimals: decimals })
  useReportFieldError(ownError)
  const field = useFieldControl({ id, invalid: invalid || !!ownError || undefined })

  // Latest value for handlers (stepping repeats from a timer). Updated after
  // commit, and eagerly by commit()/stepBy() so fast repeats don't lag.
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])

  function commit(text) {
    setDraft(text)
    const n = parse(text)
    if (!Object.is(n, valueRef.current ?? null)) {
      valueRef.current = n
      onChange?.(n)
    }
  }

  function accept(text) {
    const cleaned = text.replace(/[,\s_]/g, "")
    if (!pattern.test(cleaned)) return false
    commit(cleaned)
    return true
  }

  const stepBy = useCallback(
    (dir) => {
      const cur = valueRef.current
      const base = cur ?? (min != null && min > 0 ? min - dir * stepSize : 0)
      const places = Math.max(decimalsOf(stepSize), decimalsOf(base))
      let next = Number((base + dir * stepSize).toFixed(Math.min(places, 10)))
      if (min != null && next < min) next = min
      if (max != null && next > max) next = max
      const text = String(next)
      setDraft(text)
      if (!Object.is(next, cur)) {
        valueRef.current = next
        onChange?.(next)
      }
    },
    [min, max, stepSize, onChange]
  )

  // Hold-to-repeat for the stepper buttons.
  const repeat = useRef({ timeout: null, interval: null })
  const stopRepeat = useCallback(() => {
    clearTimeout(repeat.current.timeout)
    clearInterval(repeat.current.interval)
  }, [])
  useEffect(() => stopRepeat, [stopRepeat])
  function startRepeat(dir) {
    stopRepeat()
    stepBy(dir)
    repeat.current.timeout = setTimeout(() => {
      repeat.current.interval = setInterval(() => stepBy(dir), 60)
    }, 400)
  }

  const hasSteppers = stepper && !disabled

  return (
    <div className={cn("relative inline-flex w-full items-stretch", className)}>
      {prefix && (
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {prefix}
        </span>
      )}
      <input
        ref={ref}
        type="text"
        inputMode={integer ? "numeric" : "decimal"}
        autoComplete="off"
        id={field.id}
        {...field.ariaProps}
        value={draft}
        disabled={disabled}
        onBeforeInput={(e) => {
          // Reject a typed character before it lands (keeps the caret put).
          const el = e.currentTarget
          const data = e.data ?? ""
          const next = el.value.slice(0, el.selectionStart ?? el.value.length) + data +
            el.value.slice(el.selectionEnd ?? el.value.length)
          if (!pattern.test(next)) e.preventDefault()
        }}
        onPaste={(e) => {
          const el = e.currentTarget
          const pasted = e.clipboardData?.getData("text") ?? ""
          const next = el.value.slice(0, el.selectionStart ?? el.value.length) + pasted +
            el.value.slice(el.selectionEnd ?? el.value.length)
          e.preventDefault()
          accept(next)
        }}
        onChange={(e) => {
          // Final guard (autofill, IME, tests): only well-formed text is kept.
          accept(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault()
            if (!disabled) stepBy(e.key === "ArrowUp" ? 1 : -1)
          }
          onKeyDown?.(e)
        }}
        onBlur={(e) => {
          // Tidy partial input: "1." → "1", "-" → "".
          const n = parse(draft)
          const tidy = format(n)
          if (tidy !== draft) setDraft(tidy)
          onBlur?.(e)
        }}
        className={cn(
          controlClass,
          "w-full min-w-0 tabular-nums",
          prefix && "pl-6",
          suffix && !hasSteppers && "pr-8",
          suffix && hasSteppers && "pr-12",
          !suffix && hasSteppers && "pr-6",
          field.invalid && invalidClass,
          inputClassName
        )}
        {...props}
      />
      {suffix && (
        <span
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 text-xs text-muted-foreground",
            hasSteppers ? "right-6" : "right-2.5"
          )}
        >
          {suffix}
        </span>
      )}
      {hasSteppers && (
        <div className="absolute inset-y-px right-px flex w-5 flex-col overflow-hidden rounded-r-md border-l border-input">
          {[
            [1, "Increase"],
            [-1, "Decrease"],
          ].map(([dir, label]) => (
            <button
              key={dir}
              type="button"
              tabIndex={-1}
              aria-label={`${label}${props["aria-label"] ? ` ${props["aria-label"]}` : ""}`}
              // Keep focus in the input; repeat while held.
              onPointerDown={(e) => {
                e.preventDefault()
                startRepeat(dir)
              }}
              onPointerUp={stopRepeat}
              onPointerLeave={stopRepeat}
              onPointerCancel={stopRepeat}
              onClick={(e) => {
                // Keyboard/AT activation (no pointer events) still steps once.
                if (e.detail === 0) stepBy(dir)
              }}
              className="flex flex-1 items-center justify-center bg-muted/40 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-accent"
            >
              {dir === 1
                ? <ChevronUp size={11} strokeWidth={2.5} aria-hidden="true" />
                : <ChevronDown size={11} strokeWidth={2.5} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})

function buildPattern({ allowNegative, decimals }) {
  const sign = allowNegative ? "-?" : ""
  if (decimals === 0) return new RegExp(`^${sign}\\d*$`)
  const frac = decimals == null ? "\\d*" : `\\d{0,${decimals}}`
  return new RegExp(`^${sign}\\d*(\\.${frac})?$`)
}

function parse(text) {
  if (text == null) return null
  const t = String(text).trim()
  if (t === "" || t === "-" || t === "." || t === "-.") return null
  const n = Number(t.endsWith(".") ? t.slice(0, -1) : t)
  return Number.isFinite(n) ? n : null
}

function format(value) {
  return value == null || Number.isNaN(value) ? "" : String(value)
}
