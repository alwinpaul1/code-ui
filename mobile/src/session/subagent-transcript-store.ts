// One subagent transcript viewer for the session screen. A roster row calls
// `openSubagentTranscript(target)`; the session content mounts one
// <MobileSubagentTranscriptModal/> that subscribes here. Kept out of props for
// the same reason as the image preview: the row lives three components below
// the screen that knows the host, and two of those sit at their line caps.
import { useSyncExternalStore } from 'react'
import type { CcrEvent } from './ccr-session-api'
import type { SubagentTranscriptTarget } from './mobile-subagent-transcript'

/** The target plus whether the roster lists it as running, which the header
 *  names; the transcript itself is read the same way either way. Kept current
 *  by the tab's roster while the viewer is open (`followSubagentTranscriptRunning`). */
export type SubagentTranscriptRequest = {
  target: SubagentTranscriptTarget
  running: boolean
  /** The agent's own events in Anthropic's stream, when it held some at the tap: the viewer adds
   *  them to the file's rows (subagent-stream-file-union.ts). */
  stream?: SubagentTranscriptStream | null
}

/** The Agent call the events belong to, and the stream's events (all of them, oldest first). */
export type SubagentTranscriptStream = { toolUseId: string; events: readonly CcrEvent[] }

let state: SubagentTranscriptRequest | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function openSubagentTranscript(target: SubagentTranscriptTarget, running: boolean, stream: SubagentTranscriptStream | null = null): void {
  state = { target, running, stream }
  emit()
}

/** The stream's newest events, from the tab's tasks provider, so a viewer drawn from the stream
 *  stays live. A stream that went away (null) leaves the viewer on what it last held. */
export function followSubagentTranscriptStream(events: readonly CcrEvent[] | null): void {
  if (state === null || !state.stream || events === null || state.stream.events === events) {
    return
  }
  state = { ...state, stream: { ...state.stream, events } }
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
