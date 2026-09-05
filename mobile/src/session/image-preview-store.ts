// A single full-screen image viewer for chat thumbnails. Bubbles call
// `openImagePreview(uri)`; the chat view mounts one <ImagePreviewModal/> that
// subscribes here. Kept out of props so no list re-renders on open/close.
import { useSyncExternalStore } from 'react'

type ImagePreviewState = { uri: string; label: string } | null

let state: ImagePreviewState = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function openImagePreview(uri: string, label = 'Image'): void {
  state = { uri, label }
  emit()
}

export function closeImagePreview(): void {
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

export function useImagePreview(): ImagePreviewState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state
  )
}

/** Test/read-only access to the current preview. */
export function peekImagePreview(): ImagePreviewState {
  return state
}

export function resetImagePreviewForTests(): void {
  state = null
  listeners.clear()
}
