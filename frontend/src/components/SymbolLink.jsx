import { Tooltip } from "@/components/ui/Tooltip"
import { useTickerDetails } from "@/lib/tickerDetails"
import { cn } from "@/lib/utils"

/**
 * A ticker symbol that opens the details panel. Hover shows the company name.
 * Renders plain text when there's no details provider.
 */
export function SymbolLink({ symbol, name, className }) {
  const details = useTickerDetails()
  const base = cn("font-semibold tracking-wide", className)

  if (!details) {
    const text = <span className={cn(base, name && "cursor-default")}>{symbol}</span>
    return name ? <Tooltip content={name}>{text}</Tooltip> : text
  }
  return (
    <Tooltip content={name ? `${name} · details` : "Show details"}>
      <button
        type="button"
        onClick={() => details.open(symbol)}
        className={cn(
          base,
          "rounded-sm underline decoration-dotted decoration-muted-foreground/50 underline-offset-4",
          "hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
        aria-haspopup="dialog"
      >
        {symbol}
      </button>
    </Tooltip>
  )
}
