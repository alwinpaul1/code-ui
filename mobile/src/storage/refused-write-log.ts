/** What a refused write was doing: storing a value, or taking one away. */
export type RefusedWriteOperation = 'save' | 'erase'

/**
 * What the next write to the same key waits behind: it settles when `write`
 * does and never rejects, so a write the store refused cannot fail the read or
 * the write queued after it.
 *
 * It is also the one place a refusal is logged. The barrier this replaced,
 * `write.catch(() => undefined)`, marked the rejection handled, so a caller
 * that dropped the returned promise raised no unhandled rejection either, and
 * every caller of these stores drops it or swallows it. A full disk then left
 * no trace at all. The composer's erase after a send is where that hurt: the
 * sent text stays on disk and comes back as the draft
 * (use-debounced-persist.ts), and nothing said why (review, 2026-09-30).
 *
 * One line per refused write: the store, the operation, and the store's own
 * error. Never the value, which can be a draft or a queued message.
 */
export function barrierAfterWrite(
  write: Promise<unknown>,
  store: string,
  operation: RefusedWriteOperation
): Promise<void> {
  return write.then(
    () => undefined,
    (error: unknown) => {
      console.warn(`[storage] could not ${operation} the ${store}`, error)
    }
  )
}
