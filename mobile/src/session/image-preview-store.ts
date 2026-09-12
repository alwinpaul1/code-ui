// A single full-screen image viewer for chat thumbnails. Bubbles call
// `openImagePreview(uri)`; the chat view mounts one <ImagePreviewModal/> that
// subscribes here. Kept out of props so no list re-renders on open/close.
import { useSyncExternalStore } from 'react'

/** `uri` is the one on screen; `uris`/`index` page through the message's
 *  images, "5 of 6" like the Claude app's viewer (2026-09-12). */
type ImagePreviewState = { uri: string; uris: string[]; index: number; label: string } | null

let state: ImagePreviewState = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function openImagePreview(uri: string | string[], label = 'Image', index = 0): void {
  const uris = Array.isArray(uri) ? uri : [uri]
  const at = Math.min(Math.max(index, 0), Math.max(uris.length - 1, 0))
  state = { uri: uris[at] ?? '', uris, index: at, label }
  emit()
}

/** Page to another image of the open set (swipe or arrow). */
export function setImagePreviewIndex(index: number): void {
  if (state === null) {
    return
  }
  const at = Math.min(Math.max(index, 0), state.uris.length - 1)
  if (at === state.index) {
    return
  }
  state = { ...state, uri: state.uris[at] ?? '', index: at }
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
