import { Check, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * "3/5" signal score badge, coloured by the fraction achieved so it stays
 * meaningful as the signal set (and therefore `max`) grows. Shared by the
 * Screener and the Watchlist.
 */
export function ScoreBadge({ score, max, normalized }) {
  const frac = normalized != null ? normalized : max ? score / max : 0
  const variant = frac >= 0.6 ? "bull" : frac > 0 ? "secondary" : "neutral"
  return (
    <Badge variant={variant} aria-label={`Signal score ${score} of ${max}`}>
      {score}/{max}
    </Badge>
  )
}

/** Tooltip body: the active (enabled) signals, for quick reference. */
export function ActiveSignalsTip({ rules }) {
  if (!rules?.length) return <span>No active signals.</span>
  const total = rules.reduce((sum, r) => sum + (r.weight ?? 1), 0)
  return (
    <div className="space-y-1.5">
      <div className="font-medium">
        Active signals <span className="text-zinc-400 font-normal">({total} points max)</span>
      </div>
      <ul className="space-y-1">
        {rules.map((r) => (
          <li key={r.slug}>
            <span className="text-zinc-100">{r.name}</span>
            <span className="ml-1 text-zinc-400 tabular-nums">×{r.weight}</span>
            {r.formatted && <div className="font-mono text-[10px] text-zinc-400">{r.formatted}</div>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Tooltip body: which active signals fired for one ticker. */
export function FiredSignalsTip({ rules, signals }) {
  if (!rules?.length) return <span>No active signals.</span>
  return (
    <ul className="space-y-0.5">
      {rules.map((r) => {
        const fired = !!signals?.[r.slug]
        return (
          <li key={r.slug} className={cn("flex items-center gap-1.5", !fired && "text-zinc-400")}>
            {fired
              ? <Check size={11} className="text-green-400" aria-hidden="true" />
              : <X size={11} aria-hidden="true" />}
            <span>{r.name}</span>
            <span className="tabular-nums text-zinc-500">×{r.weight}</span>
          </li>
        )
      })}
    </ul>
  )
}
