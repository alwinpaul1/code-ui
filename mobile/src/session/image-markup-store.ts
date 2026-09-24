// A single full-screen markup editor, the same one-viewer pattern as
// `image-preview-store`: callers open it with `openImageMarkup(uri, ...)`,
// the root layout mounts one <MobileImageMarkupEditor/> that subscribes
// here. Kept out of props so nothing above it re-renders on open/close.
import { useSyncExternalStore } from 'react'

export type ImageMarkupResult = { readonly base64: string }

export type ImageMarkupState = {
  readonly uri: string
  /** Bumped on every open, including a reopen on the same uri, so the editor's
   *  reset effect cannot mistake a fresh session for a stale one. */
  readonly token: number
  readonly onDone: (result: ImageMarkupResult) => void
  /** Fired when "Discard" is chosen on a marked-up photo; absent handlers are
   *  fine — a composer chip that never uploaded anything has nothing to undo. */
  readonly onDiscard?: () => void
} | null

let state: ImageMarkupState = null
let nextToken = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function openImageMarkup(
  uri: string,
  handlers: { onDone: (result: ImageMarkupResult) => void; onDiscard?: () => void }
): void {
  nextToken += 1
  state = { uri, token: nextToken, ...handlers }
  emit()
}

export function closeImageMarkup(): void {
  if (state === null) {
    return
  }
  state = null
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useImageMarkup(): ImageMarkupState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state
  )
}

/** Test/read-only access to the current markup session. */
export function peekImageMarkup(): ImageMarkupState {
  return state
}

export function resetImageMarkupForTests(): void {
  state = null
  nextToken = 0
  listeners.clear()
}
