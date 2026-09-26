// One subagent transcript viewer for the session screen. A roster row calls
// `openSubagentTranscript(target)`; the session content mounts one
// <MobileSubagentTranscriptModal/> that subscribes here. Kept out of props for
// the same reason as the image preview: the row lives three components below
// the screen that knows the host, and two of those sit at their line caps.
import { useSyncExternalStore } from 'react'
import type { SubagentTranscriptTarget } from './mobile-subagent-transcript'

/** The target plus whether the roster lists it as running, which the header
 *  names; the transcript itself is read the same way either way. Kept current
 *  by the tab's roster while the viewer is open (`followSubagentTranscriptRunning`). */
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

/** The roster's current running set, from the one reader that owns it. The
 *  open viewer's header follows it both ways; the target is kept as it is, so
 *  the viewer's subscription is not torn down for a word in its header. */
export function followSubagentTranscriptRunning(runningAgentIds: ReadonlySet<string>): void {
  if (state === null) {
    return
  }
  const running = runningAgentIds.has(state.target.agentId)
  if (running === state.running) {
    return
  }
  state = { ...state, running }
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
