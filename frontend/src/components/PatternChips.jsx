import { Badge } from "@/components/ui/badge"
import { Tooltip } from "@/components/ui/Tooltip"

const MAX_CHIPS = 3
const VARIANT = { bullish: "bull", bearish: "bear", neutral: "neutral" }
const ORDER = { bullish: 0, bearish: 1, neutral: 2 }

/**
 * Candlestick patterns that fired on a row's latest bar, from the snapshot's
 * sparse `extra` (only fired keys are stored). Coloured by direction, with the
 * meaning in a tooltip. "—" when nothing fired or patterns weren't computed.
 */
export function PatternChips({ extra, variables }) {
  const fired = variables
    .filter((v) => v.direction && v.group?.includes("latest") && extra?.[v.name])
    .sort((a, b) => ORDER[a.direction] - ORDER[b.direction])
  if (!fired.length) return <span className="text-muted-foreground">—</span>

  const shown = fired.slice(0, MAX_CHIPS)
  const rest = fired.slice(MAX_CHIPS)
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((v) => (
        <Tooltip key={v.name} content={<PatternTip v={v} />}>
          <Badge variant={VARIANT[v.direction]} className="cursor-help px-2 py-0 text-[11px] font-medium whitespace-nowrap">
            {chipText(v.label)}
          </Badge>
        </Tooltip>
      ))}
      {rest.length > 0 && (
        <Tooltip content={<div className="space-y-2">{rest.map((v) => <PatternTip key={v.name} v={v} />)}</div>}>
          <Badge variant="outline" className="cursor-help px-2 py-0 text-[11px] font-medium" aria-label={`${rest.length} more patterns`}>
            +{rest.length}
          </Badge>
        </Tooltip>
      )}
    </div>
  )
}

// "Engulfing (bullish)" → "Engulfing": the chip colour already carries direction.
function chipText(label) {
  return label.replace(/ \((bullish|bearish)\)$/, "")
}

function PatternTip({ v }) {
  return (
    <div className="max-w-64">
      <div className="font-medium">{v.label}</div>
      <div className="text-zinc-400">{v.description}</div>
    </div>
  )
}
