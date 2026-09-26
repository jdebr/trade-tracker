// Save-time checks and error messages for the signal builder dialog.

/** Weight must be a whole number ≥ 1 (the score is a sum of integer weights). */
export function weightError(weight) {
  const s = String(weight ?? "").trim()
  if (s === "") return "Required."
  if (!/^\d+$/.test(s) || Number(s) < 1) return "Must be a whole number, 1 or more."
  return null
}

/** Turn an `API <status>: <body>` error into something a user can act on. */
export function friendlyError(err) {
  const m = err?.message || ""
  const status = Number(m.match(/^API (\d{3})/)?.[1])
  let detail
  try {
    detail = JSON.parse(m.slice(m.indexOf(":") + 1)).detail
  } catch {
    detail = undefined
  }
  if (status === 409) {
    // The server says whether the clash is with a removed (restorable) signal.
    return typeof detail === "string" && detail
      ? `${detail[0].toUpperCase()}${detail.slice(1)}.`
      : "A signal with this name already exists — pick a different name."
  }
  if (status === 422) {
    if (Array.isArray(detail) && detail.length) {
      // Pydantic field errors: [{loc: ["body", "weight"], msg}, …]
      const msgs = detail.map((d) => {
        const field = d.loc?.[d.loc.length - 1]
        return field && field !== "body" ? `${field}: ${d.msg}` : d.msg
      })
      return `Couldn't save — ${msgs.join("; ")}`
    }
    if (Array.isArray(detail?.errors)) return `Invalid expression — ${detail.errors.join("; ")}`
    if (typeof detail === "string") return `Couldn't save — ${detail}`
    return "The server rejected this signal. Check the fields and try again."
  }
  return "Could not save the signal. Check that the server is running."
}
