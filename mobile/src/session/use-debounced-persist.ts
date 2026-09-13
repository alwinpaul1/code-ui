import { useEffect, useRef } from 'react'

/**
 * Writes `value` to storage a beat after it settles, and — this is the point —
 * writes it on the way out too.
 *
 * A cleanup that only cancels the timer silently drops the last change: the
 * composer's erase after a send waited out its debounce, closing the chat inside
 * that window cancelled it, and the sent text stayed on disk to be hydrated back
 * and go out glued to the next message (reported from the phone, 2026-09-13).
 * The same drop loses the last 250 ms of anything half-typed, an optimistic
 * bubble, or a photo's preview.
 *
 * Two effects, and the split is the point. Putting the flush in the timer's own
 * cleanup flushed on every VALUE change too, because that cleanup runs whenever
 * a dependency changes — so a 200-character message became ~200 synchronous
 * storage writes instead of a handful, each one a full JSON serialization for
 * the list-shaped stores. The timer effect now only ever cancels; the flush
 * lives on an effect keyed by `key` alone, so it runs when the scope changes or
 * the screen goes away, which is exactly when a pending write would be lost.
 */
export function useDebouncedPersist<T>(
  key: string | null,
  value: T | undefined,
  delayMs: number,
  write: (key: string, value: T) => void
): void {
  /** The newest value seen for this key, and whether it has reached storage. */
  const pendingRef = useRef<{ key: string; value: T } | null>(null)
  const writeRef = useRef(write)
  writeRef.current = write

  useEffect(() => {
    if (!key || value === undefined) {
      return
    }
    pendingRef.current = { key, value }
    const timer = setTimeout(() => {
      pendingRef.current = null
      writeRef.current(key, value)
    }, delayMs)
    return () => clearTimeout(timer)
  }, [key, value, delayMs])

  useEffect(
    () => () => {
      const pending = pendingRef.current
      if (pending && pending.key === key) {
        pendingRef.current = null
        writeRef.current(pending.key, pending.value)
      }
    },
    [key]
  )
}
