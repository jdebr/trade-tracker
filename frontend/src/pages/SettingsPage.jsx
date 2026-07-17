import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Check } from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { RangeInput } from "@/components/ui/RangeInput"
import { STOP_METHODS, TARGET_METHODS } from "@/lib/exitMethods"
import { cn } from "@/lib/utils"

const inputClass =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-ring tabular-nums"

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
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

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get("/settings"),
  })

  useEffect(() => {
    if (settings && !form) setForm(settings)
  }, [settings, form])

  const { mutate: save, isPending } = useMutation({
    mutationFn: (updates) => api.patch("/settings", updates),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings"], updated)
      setError(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    },
    onError: (err) => {
      setError(
        err.message.replace(/^API \d+: /, "").replace(/^\{"detail":"(.*)"\}$/, "$1") ||
        "Failed to save settings."
      )
    },
  })

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }))

  function handleSave() {
    const { updated_at, ...updates } = form
    save(updates)
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

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Defaults for position sizing and exit plans. Any of these can be overridden
          on an individual trade.
        </p>
      </div>

      <div className="space-y-4">
        <Section
          title="Position sizing"
          description="How much of the account a single trade is allowed to risk."
        >
          <RangeInput
            label="Account size" prefix="$"
            hint="Used to compute share counts."
            value={form.account_size} onChange={set("account_size")}
            min={1000} max={250000} step={500}
            ariaLabel="Account size" numberClassName="w-28"
          />
          <RangeInput
            label="Risk per trade (%)" suffix="%"
            hint="1% is the conventional default. This is the amount you lose if the stop is hit — one R."
            value={form.risk_per_trade_pct} onChange={set("risk_per_trade_pct")}
            min={0.25} max={5} step={0.25}
            ariaLabel="Risk per trade percent"
          />
          <RangeInput
            label="Max position size (%)" suffix="%"
            hint="Warn when one trade would exceed this share of the account."
            value={form.max_position_pct} onChange={set("max_position_pct")}
            min={5} max={100} step={5}
            ariaLabel="Max position percent"
          />
        </Section>

        <Section
          title="Stop loss"
          description="Where the stop goes by default when you plan a new trade."
        >
          <Field label="Stop method">
            <select value={form.default_stop_method} onChange={(e) => set("default_stop_method")(e.target.value)}
              aria-label="Default stop method" className={cn(inputClass, "cursor-pointer")}>
              {Object.entries(STOP_METHODS).map(([k, m]) => (
                <option key={k} value={k}>{m.label}</option>
              ))}
            </select>
          </Field>
          <RangeInput
            label="ATR multiplier" suffix="×"
            hint="2–3× is the usual swing range."
            value={form.default_atr_mult} onChange={set("default_atr_mult")}
            min={1} max={5} step={0.1}
            ariaLabel="Default ATR multiplier"
          />
          <RangeInput
            label="Fixed stop (%)" suffix="%"
            hint="Used when the stop method is Fixed %."
            value={form.default_stop_pct} onChange={set("default_stop_pct")}
            min={1} max={25} step={0.5}
            ariaLabel="Default stop percent"
          />
        </Section>

        <Section
          title="Profit target"
          description="Where the target goes by default."
        >
          <Field label="Target method">
            <select value={form.default_target_method} onChange={(e) => set("default_target_method")(e.target.value)}
              aria-label="Default target method" className={cn(inputClass, "cursor-pointer")}>
              {Object.entries(TARGET_METHODS).map(([k, m]) => (
                <option key={k} value={k}>{m.label}</option>
              ))}
            </select>
          </Field>
          <RangeInput
            label="Target R" suffix="R"
            hint="2R means the trade aims to make twice what it risks."
            value={form.default_target_r} onChange={set("default_target_r")}
            min={0.5} max={5} step={0.5}
            ariaLabel="Default target R"
          />
          <RangeInput
            label="Fixed target (%)" suffix="%"
            hint="Used when the target method is Fixed %."
            value={form.default_target_pct} onChange={set("default_target_pct")}
            min={2} max={50} step={1}
            ariaLabel="Default target percent"
          />
        </Section>

        <Section
          title="Trailing & time stops"
          description="Optional rules that manage a trade after it's open."
        >
          <Field
            label="Trailing stop"
            hint="Follows price up to lock in gains. Never moves down."
          >
            <label className="flex items-center gap-2 text-sm py-1.5 cursor-pointer">
              <input type="checkbox" checked={form.trail_enabled}
                onChange={(e) => set("trail_enabled")(e.target.checked)}
                aria-label="Enable trailing stop" className="rounded border-input" />
              <span>{form.trail_enabled ? "Enabled" : "Disabled"}</span>
            </label>
          </Field>
          <RangeInput
            label="Trailing ATR multiplier" suffix="×"
            hint="Distance below the highest high since entry."
            value={form.trail_atr_mult} onChange={set("trail_atr_mult")}
            min={1} max={6} step={0.5}
            disabled={!form.trail_enabled}
            ariaLabel="Trailing ATR multiplier"
          />
          <RangeInput
            label="Time stop (trading days)" suffix="days"
            hint="Alerts when a trade has gone this long without hitting a stop or target. 0 disables it."
            value={form.time_stop_days} onChange={set("time_stop_days")}
            min={0} max={30} step={1}
            ariaLabel="Time stop days" numberClassName="w-20"
          />
        </Section>
      </div>

      <div className="mt-5 flex items-center justify-end gap-3">
        {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
        {saved && (
          <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <Check size={14} aria-hidden="true" /> Saved
          </span>
        )}
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  )
}
