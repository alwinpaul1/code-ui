// One subagent transcript viewer for the session screen. A roster row calls
// `openSubagentTranscript(target)`; the session content mounts one
// <MobileSubagentTranscriptModal/> that subscribes here. Kept out of props for
// the same reason as the image preview: the row lives three components below
// the screen that knows the host, and two of those sit at their line caps.
import { useSyncExternalStore } from 'react'
import type { SubagentTranscriptTarget } from './mobile-subagent-transcript'

/** The target plus whether the roster still lists it as running, which the
 *  header names; the transcript itself is read the same way either way. */
export type SubagentTranscriptRequest = {
  target: SubagentTranscriptTarget
  running: boolean
}

let state: SubagentTranscriptRequest | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function openSubagentTranscript(target: SubagentTranscriptTarget, running: boolean): void {
  state = { target, running }
  emit()
}

export function closeSubagentTranscript(): void {
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

export function useSubagentTranscriptRequest(): SubagentTranscriptRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state
  )
}

/** Test/read-only access to the open request. */
export function peekSubagentTranscript(): SubagentTranscriptRequest | null {
  return state
}

export function resetSubagentTranscriptForTests(): void {
  state = null
  listeners.clear()
}
