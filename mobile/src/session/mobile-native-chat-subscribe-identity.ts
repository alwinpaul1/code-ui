export type SubscribeRun = {
  identity: string
  client: unknown
  readPath: string | null
  subscribeAttempt: number
  reconnectEpoch: number
}

export type TranscriptPathPin = { sessionKey: string; pinned: string | null; moved: string | null }

/**
 * The transcript path a session is read from, as far as the chat's identity is concerned.
 *
 * A path that first APPEARS for a session (Orca's SessionStart hook names the id, the first prompt's
 * hook adds the file) is the same conversation, so it is not part of the identity: keying by it blanked
 * a resumed chat the moment the first prompt went out (2026-10-03). A path that MOVES to another file for
 * the same id is ambiguous, and the chat refuses to guess that the rows it shows belong to the new file:
 * `moved` carries it into the identity, which clears. Mutates the ref; idempotent for one set of inputs.
 */
export function pinTranscriptPath(
  ref: { current: TranscriptPathPin | null },
  sessionKey: string,
  transcriptPath: string | null
): TranscriptPathPin {
  if (ref.current === null || ref.current.sessionKey !== sessionKey) {
    ref.current = { sessionKey, pinned: null, moved: null }
  }
  const pin = ref.current
  if (transcriptPath !== null) {
    if (pin.pinned === null) {
      pin.pinned = transcriptPath
    } else if (pin.pinned !== transcriptPath) {
      pin.pinned = transcriptPath
      pin.moved = transcriptPath
    }
  }
  return pin
}

/** Why this subscribe ran, for the one log line it leaves (grep logcat for `[native-chat] subscribe`). */
export function subscribeReason(last: SubscribeRun | null, now: SubscribeRun): string {
  if (last === null) {
    return 'first'
  }
  if (last.identity !== now.identity) {
    const [, , lastSession] = JSON.parse(last.identity) as (string | null)[]
    const [, , nowSession] = JSON.parse(now.identity) as (string | null)[]
    return lastSession === nowSession ? 'path-moved' : 'new-session'
  }
  if (last.client !== now.client) {
    return 'client'
  }
  if (last.subscribeAttempt !== now.subscribeAttempt) {
    return 'ladder'
  }
  if (last.reconnectEpoch !== now.reconnectEpoch) {
    return 'reconnect'
  }
  return last.readPath !== now.readPath ? 'path-only' : 'rerun'
}

/** The file's name only: a full path names the user's home and project. */
export function pathBaseName(path: string | null): string {
  if (!path) {
    return 'none'
  }
  return path.split(/[\\/]/).pop() || 'none'
}

/** Logs the first snapshot of a subscribe, row count and `hasMore` only (no message text). Returns whether `raw` was one. */
export function logSnapshot(logBase: string, raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object' || (raw as { type?: unknown }).type !== 'snapshot') {
    return false
  }
  const snap = raw as { messages?: unknown; hasMore?: unknown; pending?: unknown }
  const rows = Array.isArray(snap.messages) ? snap.messages.length : 0
  const hasMore = typeof snap.hasMore === 'boolean' ? snap.hasMore : 'unset'
  console.warn(`${logBase} snapshot rows=${rows} hasMore=${hasMore}${snap.pending === true ? ' pending=true' : ''}`)
  return true
}

/**
 * What one run of the subscribe effect does. The rows already shown are kept (not blanked, and the
 * window asked for never drops below them plus headroom for what was written since) when the identity
 * and client are the ones the last run had: blanking them is what showed a resumed chat as empty, or as
 * its last few rows, after the first prompt (2026-10-03). Anything else starts clean.
 */
export function planSubscribe(args: {
  last: SubscribeRun | null
  run: SubscribeRun
  shown: number
  attemptLimit: number
  sessionId: string | null
  agent: string | null
  ceiling: number
  headroom: number
}): { keepRows: boolean; requested: number; logBase: string } {
  const { last, run, shown, attemptLimit } = args
  const keepRows = last !== null && last.identity === run.identity && last.client === run.client && shown > 0
  const requested = keepRows ? Math.min(Math.max(attemptLimit, shown + args.headroom), args.ceiling) : attemptLimit
  const logBase = `[native-chat] subscribe session=${(args.sessionId ?? '').slice(0, 8)} agent=${args.agent} path=${pathBaseName(run.readPath)} limit=${requested} reason=${subscribeReason(last, run)}`
  return { keepRows, requested, logBase }
}
