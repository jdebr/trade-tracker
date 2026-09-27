import { useState, useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { Skeleton } from "@/components/ui/skeleton"
import { RangeInput } from "@/components/ui/RangeInput"
import { SaveStatus } from "@/components/ui/SaveStatus"
import { Field, Select } from "@/components/ui/form"
import { useSaveQueue } from "@/lib/useSaveQueue"
import { decimalsOf, numberError } from "@/lib/validate"
import { STOP_METHODS, TARGET_METHODS } from "@/lib/exitMethods"

// Numeric settings: slider range (min/max/step) plus the hard limits the API
// enforces (SettingsUpdate: gt=0, le=100, …). One table drives both the inputs
// and autosave validation, so an invalid value is shown red and never sent.
const NUMERIC = {
  account_size:       { min: 1000, max: 250000, step: 500,  hardMin: 1 },
  risk_per_trade_pct: { min: 0.25, max: 5,      step: 0.25, hardMin: 0.01, hardMax: 100 },
  max_position_pct:   { min: 5,    max: 100,    step: 5,    hardMin: 1, hardMax: 100 },
  default_atr_mult:   { min: 1,    max: 5,      step: 0.1,  hardMin: 0.1 },
  default_stop_pct:   { min: 1,    max: 25,     step: 0.5,  hardMin: 0.1, hardMax: 99 },
  default_target_r:   { min: 0.5,  max: 5,      step: 0.5,  hardMin: 0.1 },
  default_target_pct: { min: 2,    max: 50,     step: 1,    hardMin: 1 },
  trail_atr_mult:     { min: 1,    max: 6,      step: 0.5,  hardMin: 0.1 },
  time_stop_days:     { min: 0,    max: 30,     step: 1,    hardMin: 0 },
}

const STOP_OPTIONS = Object.entries(STOP_METHODS).map(([value, m]) => ({ value, label: m.label }))
const TARGET_OPTIONS = Object.entries(TARGET_METHODS).map(([value, m]) => ({ value, label: m.label }))

function fieldError(key, value) {
  const c = NUMERIC[key]
  if (!c) return null
  const integer = Number.isInteger(c.step) && Number.isInteger(c.min)
  return numberError(value, {
    required: true,
    integer,
    min: c.hardMin,
    max: c.hardMax,
    maxDecimals: integer ? 0 : Math.max(2, decimalsOf(c.step)),
  })
}

function Section({ title, description, children }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold mb-0.5">{title}</h2>
      <p className="text-xs text-muted-foreground mb-4">{description}</p>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

/**
 * Settings autosave (M19.5): every valid change is sent ~800ms after you stop
 * editing. Nothing is ever disabled while saving; edits made mid-save are
 * queued and merged into the next request. Invalid fields turn red and are
 * held back until fixed.
 */
export default function SettingsPage() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(null)

  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get("/settings"),
  })

  useEffect(() => {
    if (settings && !form) setForm(settings)
  }, [settings, form])

  const queue = useSaveQueue((updates) => api.patch("/settings", updates), {
    debounceMs: 800,
    merge: (queued, next) => ({ ...queued, ...next }),
    // Keep the cache fresh for other pages, but never overwrite the form —
    // the user may have typed more since this request left.
    onSuccess: (updated) => queryClient.setQueryData(["settings"], updated),
  })

  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (!fieldError(key, value)) queue.save({ [key]: value })
  }

  if (isLoading || !form) {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-5">Settings</h1>
        <div className="space-y-4" aria-label="Loading settings">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  const range = (key, props) => (
    <RangeInput
      {...NUMERIC[key]}
      required
      value={form[key]}
      onChange={set(key)}
      {...props}
    />
  )

  return (
    <div className="max-w-3xl">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Defaults for position sizing and exit plans. Any of these can be overridden
            on an individual trade. Changes save automatically.
          </p>
        </div>
        <SaveStatus
          status={queue.status}
          error={queue.error}
          onRetry={queue.retry}
          className="mt-2 shrink-0"
        />
      </div>

      <div className="space-y-4">
        <Section
          title="Position sizing"
          description="How much of the account a single trade is allowed to risk."
        >
          {range("account_size", {
            label: "Account size", prefix: "$", hint: "Used to compute share counts.",
            ariaLabel: "Account size", numberClassName: "w-32",
          })}
          {range("risk_per_trade_pct", {
            label: "Risk per trade (%)", suffix: "%", ariaLabel: "Risk per trade percent",
            hint: "1% is the conventional default. This is the amount you lose if the stop is hit — one R.",
          })}
          {range("max_position_pct", {
            label: "Max position size (%)", suffix: "%", ariaLabel: "Max position percent",
            hint: "Warn when one trade would exceed this share of the account.",
          })}
        </Section>

        <Section
          title="Stop loss"
          description="Where the stop goes by default when you plan a new trade."
        >
          <Field label="Stop method">
            <Select
              value={form.default_stop_method}
              onValueChange={set("default_stop_method")}
              options={STOP_OPTIONS}
              aria-label="Default stop method"
            />
          </Field>
          {range("default_atr_mult", {
            label: "ATR multiplier", suffix: "×", ariaLabel: "Default ATR multiplier",
            hint: "2–3× is the usual swing range.",
          })}
          {range("default_stop_pct", {
            label: "Fixed stop (%)", suffix: "%", ariaLabel: "Default stop percent",
            hint: "Used when the stop method is Fixed %.",
          })}
        </Section>

        <Section
          title="Profit target"
          description="Where the target goes by default."
        >
          <Field label="Target method">
            <Select
              value={form.default_target_method}
              onValueChange={set("default_target_method")}
              options={TARGET_OPTIONS}
              aria-label="Default target method"
            />
          </Field>
          {range("default_target_r", {
            label: "Target R", suffix: "R", ariaLabel: "Default target R",
            hint: "2R means the trade aims to make twice what it risks.",
          })}
          {range("default_target_pct", {
            label: "Fixed target (%)", suffix: "%", ariaLabel: "Default target percent",
            hint: "Used when the target method is Fixed %.",
          })}
        </Section>

        <Section
          title="Trailing & time stops"
          description="Optional rules that manage a trade after it's open."
        >
          <Field label="Trailing stop" hint="Follows price up to lock in gains. Never moves down.">
            <label className="flex items-center gap-2 text-sm py-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.trail_enabled}
                onChange={(e) => set("trail_enabled")(e.target.checked)}
                aria-label="Enable trailing stop"
                className="rounded border-input accent-primary"
              />
              <span>{form.trail_enabled ? "Enabled" : "Disabled"}</span>
            </label>
          </Field>
          {range("trail_atr_mult", {
            label: "Trailing ATR multiplier", suffix: "×", ariaLabel: "Trailing ATR multiplier",
            hint: "Distance below the highest high since entry.",
            disabled: !form.trail_enabled,
          })}
          {range("time_stop_days", {
            label: "Time stop (trading days)", suffix: "days", ariaLabel: "Time stop days",
            hint: "Alerts when a trade has gone this long without hitting a stop or target. 0 disables it.",
          })}
        </Section>
      </div>
    </div>
  )
}
