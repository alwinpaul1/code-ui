import { useCallback, useSyncExternalStore } from 'react'

/**
 * Which refusal cards have their reason open (Why? / Hide), by the card's row id, held above the
 * list (review 2026-10-15). The chat list virtualises its rows, so a card scrolled out of view and
 * back is a new mount; state kept in the row came back closed. Kept out of props for the same
 * reason as the card's Edit and retry (ccr-refusal-retry.ts): the rows between sit at their caps.
 *
 * Row ids are the session events' uuids, unique across tabs. Only the newest
 * `CCR_REFUSAL_EXPANDED_KEPT` open cards are remembered, so the set cannot grow without end.
 */

export const CCR_REFUSAL_EXPANDED_KEPT = 64

let open: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setOpen(rowId: string, next: boolean): void {
  if (open.has(rowId) === next) {
    return
  }
  const ids = [...open].filter((id) => id !== rowId)
  if (next) {
    ids.push(rowId)
  }
  open = new Set(ids.slice(-CCR_REFUSAL_EXPANDED_KEPT))
  for (const listener of listeners) {
    listener()
  }
}

/** Whether this card's reason is open, and the toggle. */
export function useCcrRefusalExpanded(rowId: string): [boolean, () => void] {
  const expanded = useSyncExternalStore(
    subscribe,
    () => open.has(rowId),
    () => open.has(rowId)
  )
  const toggle = useCallback(() => setOpen(rowId, !open.has(rowId)), [rowId])
  return [expanded, toggle]
}

export function resetCcrRefusalExpandedForTests(): void {
  open = new Set()
  listeners.clear()
}
