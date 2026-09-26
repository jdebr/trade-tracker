import { createContext, useContext, useEffect } from "react"

/**
 * Wiring between a <Field> and the control inside it: the control's id (so the
 * label points at it), the hint's id (aria-describedby), whether the field is
 * currently invalid, and a way for a control to report its own constraint
 * error (e.g. NumberInput's "Min 1") so the Field can show it.
 */
export const FieldContext = createContext(null)

/** Merge Field-provided a11y + invalid state into a control's props. */
export function useFieldControl({ id, invalid, describedBy } = {}) {
  const ctx = useContext(FieldContext)
  const isInvalid = invalid ?? ctx?.invalid ?? false
  const describedByIds = [describedBy, ctx?.hintId].filter(Boolean).join(" ") || undefined
  return {
    id: id ?? ctx?.id,
    invalid: isInvalid,
    ariaProps: {
      "aria-invalid": isInvalid || undefined,
      "aria-describedby": describedByIds,
    },
  }
}

/** Report a control's own validation error to its enclosing Field (if any). */
export function useReportFieldError(error) {
  const ctx = useContext(FieldContext)
  const report = ctx?.report
  useEffect(() => {
    if (!report) return
    report(error ?? null)
    return () => report(null)
  }, [report, error])
}
