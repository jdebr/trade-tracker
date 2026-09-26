import { useCallback, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"

/**
 * A react-query mutation that tracks pending state *per key* (M19.5 / UX2).
 *
 *   const toggle = useKeyedMutation({
 *     keyOf: ({ id }) => id,
 *     mutationFn: ({ id, enabled }) => api.patch(`/signal-rules/${id}`, { enabled }),
 *     onMutate / onError / onSuccess / onSettled,   // passed through
 *   })
 *   toggle.mutate({ id, enabled })
 *   toggle.isPending(id)     // spinner for this row only
 *
 * One row's request never disables another row. A second call for a key that
 * is already in flight is ignored (the guard against double-submits), and
 * reported via the `mutate` return value (false = ignored).
 */
export function useKeyedMutation({ keyOf, ...options }) {
  const [pendingKeys, setPendingKeys] = useState(() => new Set())
  const inFlight = useRef(new Set())

  const mutation = useMutation({
    ...options,
    onSettled: (...args) => {
      const key = keyOf(args[2])
      inFlight.current.delete(key)
      setPendingKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
      return options.onSettled?.(...args)
    },
  })

  const { mutate: rawMutate, mutateAsync: rawMutateAsync } = mutation

  const begin = useCallback(
    (vars) => {
      const key = keyOf(vars)
      if (inFlight.current.has(key)) return null
      inFlight.current.add(key)
      setPendingKeys((prev) => new Set(prev).add(key))
      return key
    },
    [keyOf]
  )

  const mutate = useCallback(
    (vars, callOptions) => {
      if (begin(vars) === null) return false
      rawMutate(vars, callOptions)
      return true
    },
    [begin, rawMutate]
  )

  const mutateAsync = useCallback(
    (vars, callOptions) => {
      if (begin(vars) === null) return Promise.resolve(undefined)
      return rawMutateAsync(vars, callOptions)
    },
    [begin, rawMutateAsync]
  )

  const isPending = useCallback((key) => pendingKeys.has(key), [pendingKeys])

  return { mutate, mutateAsync, isPending, anyPending: pendingKeys.size > 0, error: mutation.error }
}
