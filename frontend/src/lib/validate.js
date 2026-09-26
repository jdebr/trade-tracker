// Shared validators. Each returns a *short* hint string when the value is
// invalid ("Required", "Min 1") or null when it's fine, so the result can be
// passed straight to <Field error>.

export function isBlank(v) {
  return v == null || (typeof v === "string" && v.trim() === "")
}

export function required(v) {
  return isBlank(v) ? "Required" : null
}

/** Number of digits after the decimal point in a finite number. */
export function decimalsOf(n) {
  if (!Number.isFinite(n)) return 0
  const s = String(n)
  if (s.includes("e-")) return Number(s.split("e-")[1])
  const dot = s.indexOf(".")
  return dot === -1 ? 0 : s.length - dot - 1
}

/**
 * Validate a numeric value (as emitted by <NumberInput>: number or null).
 * Options mirror NumberInput's props so callers can reuse the same config.
 */
export function numberError(v, { required: req = false, integer = false, min, max, maxDecimals } = {}) {
  if (v == null || Number.isNaN(v)) return req ? "Required" : null
  if (integer && !Number.isInteger(v)) return "Whole number"
  if (min != null && v < min) return `Min ${min}`
  if (max != null && v > max) return `Max ${max}`
  if (maxDecimals != null && decimalsOf(v) > maxDecimals) {
    return maxDecimals === 0 ? "Whole number" : `Max ${maxDecimals} decimals`
  }
  return null
}

/** The first non-null error, or null. */
export function firstError(...errors) {
  return errors.find(Boolean) ?? null
}
