import { useState, useEffect } from "react"

/**
 * Returns a debounced copy of `value` that only updates after `delay` ms have
 * passed without a change. Used to keep an input responsive while throttling the
 * expensive work it triggers (e.g. a recalculation request per keystroke).
 */
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
