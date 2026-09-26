import { useId, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { FieldContext } from "./fieldContext"

/**
 * Label + control + one short line underneath.
 *
 * The line shows `error` (red) when there is one — either passed in, or
 * reported by the control itself (NumberInput range errors) — otherwise the
 * optional `hint`. The control picks up its id, aria-invalid and
 * aria-describedby from context, so callers don't wire them by hand.
 */
export function Field({ label, hint, error, children, className, labelClassName }) {
  const id = useId()
  const hintId = `${id}-hint`
  const [reported, setReported] = useState(null)
  const shown = error || reported || null

  const ctx = useMemo(
    () => ({ id, hintId: shown || hint ? hintId : undefined, invalid: !!shown, report: setReported }),
    [id, hintId, shown, hint]
  )

  return (
    <div className={cn("flex flex-col gap-1 min-w-0", className)}>
      {label && (
        <label htmlFor={id} className={cn("text-xs font-medium text-muted-foreground", labelClassName)}>
          {label}
        </label>
      )}
      <FieldContext.Provider value={ctx}>{children}</FieldContext.Provider>
      {shown ? (
        <span id={hintId} className="text-[11px] leading-tight text-red-400">
          {shown}
        </span>
      ) : (
        hint && (
          <span id={hintId} className="text-[11px] leading-tight text-muted-foreground/80">
            {hint}
          </span>
        )
      )}
    </div>
  )
}
