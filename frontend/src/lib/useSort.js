import { useState, useMemo } from "react"

/**
 * Sort a list of row objects by a column key, toggling ascending/descending on
 * repeated requests for the same key.
 *
 * Comparison handles numbers, strings, and booleans, and always sorts
 * null/undefined to the bottom regardless of direction (a missing value isn't
 * "smaller", it's just absent).
 *
 * Usage:
 *   const { sorted, sortKey, sortDir, requestSort } = useSort(rows, { key: "symbol", dir: "asc" })
 *   ...
 *   <SortHeader label="RSI" sortKey="rsi_14" active={sortKey==="rsi_14"} dir={sortDir} onSort={requestSort} />
 */
export function useSort(items, initial = { key: null, dir: "asc" }) {
  const [sortKey, setSortKey] = useState(initial.key)
  const [sortDir, setSortDir] = useState(initial.dir)

  const requestSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return items
    const factor = sortDir === "asc" ? 1 : -1
    return [...items].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      const aEmpty = av === null || av === undefined || av === ""
      const bEmpty = bv === null || bv === undefined || bv === ""
      // Missing values always sink to the bottom — apply this OUTSIDE the
      // direction factor so descending doesn't flip them to the top.
      if (aEmpty && bEmpty) return 0
      if (aEmpty) return 1
      if (bEmpty) return -1
      return compare(av, bv) * factor
    })
  }, [items, sortKey, sortDir])

  return { sorted, sortKey, sortDir, requestSort }
}

function compare(a, b) {
  if (typeof a === "boolean" || typeof b === "boolean") {
    return (a ? 1 : 0) - (b ? 1 : 0)
  }
  const an = Number(a)
  const bn = Number(b)
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn
  return String(a).localeCompare(String(b))
}
