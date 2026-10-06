import { createPersistedMap } from './session-cache-persistence'
import type { StartupFrameRead } from './claude-startup-frame'
import { modelsDiffer, type ClaudeModelFallback } from './claude-transcript-model'

/**
 * What a Claude session's own startup frame last said about it, kept per
 * session id (claude-startup-frame.ts says what that statement is and is not).
 *
 * The frame scrolls off the host's screen as soon as the conversation grows past
 * one screen, and a late attach, a reconnect or a long session finds it gone, so
 * the last pair read is kept by session id and persisted with the other session
 * caches (session-cache-persistence.ts: one blob, fail-open both ways). A
 * missing record costs a pill, never a wrong one.
 */
export type StartupFramePair = StartupFrameRead & {
  /** When the phone first read this frame (its own clock). */
  readAt: number
}

const pairs = createPersistedMap<StartupFramePair>({
  storageKey: 'codeui:chat-startup-frame-pairs',
  maxEntries: 32
})
const listeners = new Set<() => void>()

/** Read at app start with the other session caches; never rejects. */
export function hydrateStartupFramePairs(): Promise<void> {
  return pairs.hydrate().then(() => listeners.forEach((listener) => listener()))
}

/** Test-only: a fresh process, with storage left as it is. */
export function resetStartupFramePairsForTests(): void {
  pairs.reset()
  listeners.clear()
}

export function peekStartupFramePair(sessionId: string | null): StartupFramePair | null {
  return sessionId === null ? null : (pairs.get(sessionId) ?? null)
}

export function subscribeStartupFramePairs(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Keep what a frame on screen just said. The newest frame replaces the one
 * held (a resume or `/clear` paints a new one). A narrow pane that states the
 * same model without its effort never erases an effort a wide read stated.
 */
export function rememberStartupFramePair(sessionId: string | null, read: StartupFrameRead | null): void {
  if (sessionId === null || read == null) {
    return
  }
  const held = pairs.get(sessionId)
  const effort = read.effort ?? (held !== undefined && !modelsDiffer(held.model, read.model) ? held.effort : null)
  if (held !== undefined && held.model === read.model && held.effort === effort) {
    return
  }
  pairs.set(sessionId, { model: read.model, label: read.label, effort, readAt: held?.model === read.model ? held.readAt : Date.now() })
  listeners.forEach((listener) => listener())
}

/**
 * The fallback with the startup frame laid under it, for a session no beacon or
 * badge speaks for. Order, newest statement first (the caller lays the
 * session's own `/model` and `/effort` rows over the result, and a live beacon
 * over all of it):
 *
 * - The transcript scan names a DIFFERENT model: the scan wins and the frame is
 *   dropped, effort included. The frame is a statement from the launch; a
 *   reply written under another model is later (a picker or alt+p switch writes
 *   no row, and a resume into a new process is the case this cannot tell apart
 *   and so refuses to guess about).
 * - The scan names the SAME model: it carries no effort, so the frame supplies
 *   the one it stated.
 * - No scan: the frame names the model and effort.
 * - No frame: the fallback as it was.
 */
export function withStartupFramePair(fallback: ClaudeModelFallback, frame: StartupFramePair | null): ClaudeModelFallback {
  if (frame === null) {
    return fallback
  }
  if (fallback.kind === 'transcript') {
    return modelsDiffer(fallback.model.model, frame.model) ? fallback : { ...fallback, effort: fallback.effort ?? frame.effort }
  }
  return { kind: 'transcript', model: { model: frame.model, label: frame.label }, effort: frame.effort }
}
