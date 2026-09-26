import { useCallback, useEffect, useRef, useState } from "react"

/**
 * A save pipeline that never blocks editing (M19.5 / UX2).
 *
 *   const q = useSaveQueue((payload) => api.patch("/settings", payload), {
 *     debounceMs: 800,
 *     merge: (queued, next) => ({ ...queued, ...next }),   // optional
 *   })
 *   q.save(changes)      // call on every edit
 *
 * States (`q.status`):
 *   idle     nothing to do
 *   waiting  a change is scheduled (debounce timer running)
 *   saving   a request is in flight (edits made now are queued, not dropped)
 *   saved    the last request succeeded and nothing newer is pending
 *   error    the last request failed; `q.error` has it, `q.retry()` resends
 *
 * Rules:
 *   - At most one request is in flight. Edits during a save are coalesced
 *     (`merge`, default latest-wins) and sent as one request when it lands.
 *   - A newer edit supersedes a failed one (its payload is merged over the
 *     failed payload, so nothing the user typed is lost).
 *   - `flush()` sends a waiting change immediately; unmounting flushes too, so
 *     navigating away mid-debounce doesn't lose the edit.
 */
export function useSaveQueue(saveFn, { debounceMs = 0, merge = latestWins, onSuccess, onError } = {}) {
  const [status, setStatus] = useState("idle")
  const [error, setError] = useState(null)

  // Everything the async machinery touches lives in refs, so callbacks stay
  // stable and a late-resolving request always sees current state.
  const fnRef = useRef(saveFn)
  const optsRef = useRef({ merge, onSuccess, onError })
  useEffect(() => {
    fnRef.current = saveFn
    optsRef.current = { merge, onSuccess, onError }
  })

  const s = useRef({
    pending: undefined,   // payload waiting to be sent (debounce or queued behind a save)
    failed: undefined,    // payload of the last failed request (for retry/merge)
    inFlight: false,
    timer: null,
    mounted: true,
  })

  const setBoth = (st, err = null) => {
    if (!s.current.mounted) return
    setStatus(st)
    setError(err)
  }

  // Send whatever is pending; chains itself while edits keep arriving.
  const run = useCallback(() => {
    const step = async () => {
      const st = s.current
      if (st.inFlight || st.pending === undefined) return
      const payload = st.pending
      st.pending = undefined
      st.inFlight = true
      setBoth("saving")
      try {
        const result = await fnRef.current(payload)
        st.failed = undefined
        optsRef.current.onSuccess?.(result, payload)
        st.inFlight = false
        if (st.pending !== undefined) {
          // Edits arrived while saving — send them now (unless still debouncing).
          if (!st.timer) step()
          else setBoth("waiting")
        } else {
          setBoth("saved")
        }
      } catch (err) {
        st.inFlight = false
        st.failed = payload
        optsRef.current.onError?.(err, payload)
        if (st.pending !== undefined) {
          // A newer edit supersedes the failure; fold the failed payload under it.
          st.pending = optsRef.current.merge(payload, st.pending)
          st.failed = undefined
          if (!st.timer) step()
          else setBoth("waiting")
        } else {
          setBoth("error", err)
        }
      }
    }
    return step()
  }, [])

  const save = useCallback(
    (payload) => {
      const st = s.current
      st.pending = st.pending === undefined ? payload : optsRef.current.merge(st.pending, payload)
      clearTimeout(st.timer)
      st.timer = null
      if (st.inFlight) {
        setBoth("saving") // queued behind the current request
        if (debounceMs > 0) {
          st.timer = setTimeout(() => {
            st.timer = null
            run()
          }, debounceMs)
        }
        return
      }
      if (debounceMs > 0) {
        setBoth("waiting")
        st.timer = setTimeout(() => {
          st.timer = null
          run()
        }, debounceMs)
      } else {
        run()
      }
    },
    [debounceMs, run]
  )

  const flush = useCallback(() => {
    const st = s.current
    clearTimeout(st.timer)
    st.timer = null
    run()
  }, [run])

  const retry = useCallback(() => {
    const st = s.current
    if (st.failed === undefined) return
    st.pending = st.pending === undefined ? st.failed : optsRef.current.merge(st.failed, st.pending)
    st.failed = undefined
    flush()
  }, [flush])

  // Unmount: send anything still waiting (fire-and-forget), stop timers.
  useEffect(() => {
    const st = s.current
    st.mounted = true
    return () => {
      st.mounted = false
      if (st.timer) {
        clearTimeout(st.timer)
        st.timer = null
        if (!st.inFlight && st.pending !== undefined) {
          Promise.resolve(fnRef.current(st.pending)).catch(() => {})
          st.pending = undefined
        }
      }
    }
  }, [])

  return {
    status,
    error,
    save,
    flush,
    retry,
    /** True while anything is waiting or in flight. */
    busy: status === "waiting" || status === "saving",
  }
}

function latestWins(_queued, next) {
  return next
}
