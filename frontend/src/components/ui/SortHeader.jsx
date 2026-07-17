import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react"
import { Tooltip } from "@/components/ui/Tooltip"
import { cn } from "@/lib/utils"

/**
 * A clickable table header cell that drives useSort. Click to sort by this
 * column; click again to flip direction. The arrow shows the current state.
 *
 * Pass `tooltip` to keep an explanatory hover (e.g. indicator descriptions)
 * alongside the sort affordance.
 */
export function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = "left",
  tooltip,
  className,
}) {
  const active = activeKey === sortKey
  const Arrow = !active ? ChevronsUpDown : dir === "asc" ? ChevronUp : ChevronDown

  const alignClass =
    align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"

  const inner = (
    <span className={cn("inline-flex items-center gap-1", alignClass)}>
      {label}
      <Arrow
        size={12}
        aria-hidden="true"
        className={cn(active ? "text-foreground" : "text-muted-foreground/40")}
      />
    </span>
  )

  return (
    <th
      scope="col"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(
        "px-4 py-3 font-medium cursor-pointer select-none hover:text-foreground transition-colors",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
        className
      )}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn("inline-flex items-center w-full", alignClass)}
        aria-label={`Sort by ${label}`}
      >
        {tooltip ? <Tooltip content={tooltip}>{inner}</Tooltip> : inner}
      </button>
    </th>
  )
}
