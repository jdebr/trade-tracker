import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

/** Small inline spinner. Decorative by default; pass `label` to announce it. */
export function Spinner({ size = 14, className, label }) {
  return (
    <Loader2
      size={size}
      className={cn("shrink-0 animate-spin", className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "status" : undefined}
    />
  )
}
