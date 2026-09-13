import { useEffect } from 'react'

/**
 * Writes `value` to storage a beat after it settles, and — this is the point —
 * writes it on the way out too.
 *
 * A cleanup that only cancels the timer silently drops the last change: the
 * composer's erase after a send waited out its debounce, closing the chat inside
 * that window cancelled it, and the sent text stayed on disk to be hydrated back
 * and go out glued to the next message (reported from the phone, 2026-09-13).
 * The same drop loses the last 250 ms of anything half-typed, an optimistic
 * bubble, or a photo's preview. Each value is written at most once, so the
 * flush cannot duplicate a write the timer already made.
 */
export function useDebouncedPersist<T>(
  key: string | null,
  value: T | undefined,
  delayMs: number,
  write: (key: string, value: T) => void
): void {
  useEffect(() => {
    if (!key || value === undefined) {
      return
    }
    let written = false
    const persist = () => {
      if (!written) {
        written = true
        write(key, value)
      }
    }
    const timer = setTimeout(persist, delayMs)
    return () => {
      clearTimeout(timer)
      persist()
    }
    // `write` is a module function at every call site; re-running on a new
    // identity would re-arm the timer and defeat the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value, delayMs])
}
