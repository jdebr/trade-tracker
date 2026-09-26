import { useEffect, useState } from "react"
import { Check, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Spinner } from "./Spinner"

/**
 * Inline status for a useSaveQueue: Saving… → ✓ Saved (fades) → ⚠ Failed · Retry.
 * Sits in a polite live region so screen readers hear the outcome.
 */
export function SaveStatus({ status, error, onRetry, className, savedFor = 2500 }) {
  // "Saved" is shown briefly, then the line goes quiet again.
  const [showSaved, setShowSaved] = useState(false)
  const [lastStatus, setLastStatus] = useState(status)
  if (status !== lastStatus) {
    setLastStatus(status)
    setShowSaved(status === "saved")
  }
  useEffect(() => {
    if (!showSaved) return
    const t = setTimeout(() => setShowSaved(false), savedFor)
    return () => clearTimeout(t)
  }, [showSaved, savedFor])

  let body = null
  if (status === "waiting" || status === "saving") {
    body = (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Spinner size={12} /> Saving…
      </span>
    )
  } else if (status === "saved" && showSaved) {
    body = (
      <span className="inline-flex items-center gap-1.5 text-green-600 dark:text-green-400">
        <Check size={13} aria-hidden="true" /> Saved
      </span>
    )
  } else if (status === "error") {
    body = (
      <span className="inline-flex items-center gap-1.5 text-red-400">
        <AlertTriangle size={13} aria-hidden="true" />
        <span title={error?.message}>Couldn&rsquo;t save</span>
        {onRetry && (
          <button type="button" onClick={onRetry} className="underline underline-offset-2 hover:text-red-300">
            Retry
          </button>
        )}
      </span>
    )
  }

  return (
    <span aria-live="polite" className={cn("inline-flex min-h-5 items-center text-xs", className)}>
      {body}
    </span>
  )
}
