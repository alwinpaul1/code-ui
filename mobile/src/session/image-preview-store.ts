// A single full-screen image viewer for chat thumbnails. Bubbles call
// `openImagePreview(uri)`; the chat view mounts one <ImagePreviewModal/> that
// subscribes here. Kept out of props so no list re-renders on open/close.
import { useSyncExternalStore } from 'react'

/** What the viewer draws: a bitmap RN's Image can load, or an SVG's text
 *  (a markdown figure read off the host), which react-native-svg draws. */
export type ImagePreviewSource = { kind: 'bitmap'; uri: string } | { kind: 'svg'; xml: string }

/** `uri` is the one on screen; `uris`/`index` page through the message's
 *  images, "5 of 6" like the Claude app's viewer (2026-09-12). `sources` is
 *  the same set with SVGs kept as SVGs; `uris` holds '' for one. */
type ImagePreviewState = {
  uri: string
  uris: string[]
  sources: ImagePreviewSource[]
  index: number
  label: string
} | null

let state: ImagePreviewState = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function openImagePreview(uri: string | string[], label = 'Image', index = 0): void {
  const uris = Array.isArray(uri) ? uri : [uri]
  openImagePreviewSources(
    uris.map((uri) => ({ kind: 'bitmap', uri })),
    label,
    index
  )
}

/** Open the viewer on sources that are not all bitmaps (a markdown
 *  document's figures, some of them SVG). */
export function openImagePreviewSources(
  sources: ImagePreviewSource[],
  label = 'Image',
  index = 0
): void {
  const uris = sources.map((source) => (source.kind === 'bitmap' ? source.uri : ''))
  const at = Math.min(Math.max(index, 0), Math.max(uris.length - 1, 0))
  state = { uri: uris[at] ?? '', uris, sources, index: at, label }
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
