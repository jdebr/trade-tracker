/**
 * Interaction hooks (M19.5 / UX2).
 *
 * useSaveQueue: debounce, one-in-flight, queue-and-coalesce edits made during
 * a save, error → retry, a newer edit superseding a failure, flush on unmount.
 * useKeyedMutation: per-key pending, same-key double-submit ignored, other
 * keys unaffected.
 * SaveStatus + Button loading.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, renderHook, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useSaveQueue } from "@/lib/useSaveQueue"
import { useKeyedMutation } from "@/lib/useKeyedMutation"
import { SaveStatus } from "@/components/ui/SaveStatus"
import { Button } from "@/components/ui/button"

/** A promise we resolve/reject by hand. */
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** saveFn whose calls each return a controllable promise. */
function controllableSave() {
  const calls = []
  const fn = vi.fn((payload) => {
    const d = deferred()
    calls.push({ payload, ...d })
    return d.promise
  })
  return { fn, calls }
}

const flushPromises = () => act(async () => {})

describe("useSaveQueue", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("debounces edits into one request", async () => {
    const { fn, calls } = controllableSave()
    const { result } = renderHook(() => useSaveQueue(fn, { debounceMs: 800 }))

    act(() => result.current.save({ a: 1 }))
    act(() => result.current.save({ a: 2 }))
    expect(result.current.status).toBe("waiting")
    expect(fn).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(800))
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith({ a: 2 })
    expect(result.current.status).toBe("saving")

    calls[0].resolve({ ok: true })
    await flushPromises()
    expect(result.current.status).toBe("saved")
  })

  it("queues edits made during a save and sends them (merged) when it lands", async () => {
    const { fn, calls } = controllableSave()
    const merge = (a, b) => ({ ...a, ...b })
    const { result } = renderHook(() => useSaveQueue(fn, { merge }))

    act(() => result.current.save({ a: 1 }))
    expect(fn).toHaveBeenCalledTimes(1)

    // Two edits while the first request is in flight — nothing is dropped.
    act(() => result.current.save({ b: 2 }))
    act(() => result.current.save({ c: 3 }))
    expect(fn).toHaveBeenCalledTimes(1) // still one in flight
    expect(result.current.status).toBe("saving")

    calls[0].resolve()
    await flushPromises()
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith({ b: 2, c: 3 })

    calls[1].resolve()
    await flushPromises()
    expect(result.current.status).toBe("saved")
  })

  it("reports errors and retries the failed payload", async () => {
    const { fn, calls } = controllableSave()
    const onError = vi.fn()
    const { result } = renderHook(() => useSaveQueue(fn, { onError }))

    act(() => result.current.save({ a: 1 }))
    calls[0].reject(new Error("boom"))
    await flushPromises()
    expect(result.current.status).toBe("error")
    expect(result.current.error.message).toBe("boom")
    expect(onError).toHaveBeenCalledOnce()

    act(() => result.current.retry())
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith({ a: 1 })
    calls[1].resolve()
    await flushPromises()
    expect(result.current.status).toBe("saved")
  })

  it("a newer edit supersedes a failure without losing the failed fields", async () => {
    const { fn, calls } = controllableSave()
    const merge = (a, b) => ({ ...a, ...b })
    const { result } = renderHook(() => useSaveQueue(fn, { merge }))

    act(() => result.current.save({ a: 1 }))
    act(() => result.current.save({ b: 2 })) // queued behind the failing request
    calls[0].reject(new Error("boom"))
    await flushPromises()
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith({ a: 1, b: 2 })
  })

  it("flushes a debounced edit on unmount", () => {
    const { fn } = controllableSave()
    const { result, unmount } = renderHook(() => useSaveQueue(fn, { debounceMs: 800 }))
    act(() => result.current.save({ a: 1 }))
    unmount()
    expect(fn).toHaveBeenCalledWith({ a: 1 })
  })

  it("flush() sends a waiting edit immediately", () => {
    const { fn } = controllableSave()
    const { result } = renderHook(() => useSaveQueue(fn, { debounceMs: 800 }))
    act(() => result.current.save({ a: 1 }))
    act(() => result.current.flush())
    expect(fn).toHaveBeenCalledWith({ a: 1 })
  })
})

describe("useKeyedMutation", () => {
  function wrapper({ children }) {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }

  it("tracks pending per key and ignores a same-key double submit", async () => {
    const pending = {}
    const mutationFn = vi.fn(({ id }) => {
      const d = deferred()
      pending[id] = d
      return d.promise
    })
    const { result } = renderHook(
      () => useKeyedMutation({ keyOf: (v) => v.id, mutationFn }),
      { wrapper }
    )

    let accepted
    act(() => {
      accepted = result.current.mutate({ id: "a" })
    })
    expect(accepted).toBe(true)
    await waitFor(() => expect(result.current.isPending("a")).toBe(true))
    expect(result.current.isPending("b")).toBe(false)

    // Same key again while in flight: ignored.
    act(() => {
      accepted = result.current.mutate({ id: "a" })
    })
    expect(accepted).toBe(false)

    // Another key proceeds independently.
    act(() => {
      result.current.mutate({ id: "b" })
    })
    await waitFor(() => expect(result.current.isPending("b")).toBe(true))
    await waitFor(() => expect(mutationFn).toHaveBeenCalledTimes(2))

    await act(async () => pending.a.resolve())
    await waitFor(() => expect(result.current.isPending("a")).toBe(false))
    expect(result.current.isPending("b")).toBe(true)

    await act(async () => pending.b.resolve())
    await waitFor(() => expect(result.current.anyPending).toBe(false))
  })
})

describe("SaveStatus", () => {
  it("shows saving, saved and a retryable error", () => {
    const onRetry = vi.fn()
    const { rerender } = render(<SaveStatus status="saving" />)
    expect(screen.getByText("Saving…")).toBeInTheDocument()

    rerender(<SaveStatus status="saved" />)
    expect(screen.getByText("Saved")).toBeInTheDocument()

    rerender(<SaveStatus status="error" error={new Error("x")} onRetry={onRetry} />)
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

describe("Button loading", () => {
  it("shows busy state and swallows clicks without looking disabled", () => {
    const onClick = vi.fn()
    render(<Button loading onClick={onClick}>Save</Button>)
    const btn = screen.getByRole("button", { name: "Save" })
    expect(btn).toHaveAttribute("aria-busy", "true")
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })
})
