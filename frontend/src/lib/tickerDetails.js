import { createContext, useContext } from "react"

/**
 * App-wide ticker details panel. `TickerDetailsProvider` (mounted in the
 * layout) supplies `{ open(symbol) }`; outside it (e.g. isolated page tests)
 * this is null and symbols render as plain text.
 */
export const TickerDetailsContext = createContext(null)

export function useTickerDetails() {
  return useContext(TickerDetailsContext)
}

const MARKER = {
  bullish: { position: "belowBar", shape: "arrowUp",   color: "#10b981" },
  bearish: { position: "aboveBar", shape: "arrowDown", color: "#ef4444" },
  neutral: { position: "aboveBar", shape: "circle",    color: "#9ca3af" },
}

/**
 * Chart markers for pattern history: at most one per (date, direction), so a
 * day with doji + spinning top shows one grey dot. Sorted oldest → newest, as
 * lightweight-charts requires.
 */
export function patternMarkers(patterns = []) {
  const seen = new Set()
  const out = []
  for (const p of patterns) {
    const key = `${p.date}|${p.direction}`
    if (seen.has(key) || !MARKER[p.direction]) continue
    seen.add(key)
    out.push({ time: p.date, ...MARKER[p.direction] })
  }
  return out.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
}

/** Pattern history grouped by date, newest first: [{ date, patterns: [...] }]. */
export function groupPatternsByDate(patterns = []) {
  const groups = []
  for (const p of patterns) {
    const last = groups[groups.length - 1]
    if (last && last.date === p.date) last.patterns.push(p)
    else groups.push({ date: p.date, patterns: [p] })
  }
  return groups
}
