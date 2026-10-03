export type SubscribeRun = {
  identity: string
  client: unknown
  readPath: string | null
  subscribeAttempt: number
  reconnectEpoch: number
}

export type TranscriptPathPin = { sessionKey: string | null; pinned: string | null; moved: string | null }
export const NO_TRANSCRIPT_PATH_PIN: TranscriptPathPin = { sessionKey: null, pinned: null, moved: null }

/**
 * The transcript path a session is read from, as far as the chat's identity is concerned. Pure: the
 * hook holds the result in state.
 *
 * A path that first APPEARS for a session (Orca's SessionStart hook names the id, the first prompt's
 * hook adds the file) is the same conversation, so it is not part of the identity: keying by it blanked
 * a resumed chat the moment the first prompt went out (2026-10-03). A path that MOVES to another file for
 * the same id is ambiguous, and the chat refuses to guess that the rows it shows belong to the new file:
 * `moved` carries it into the identity, which clears. While the hook is starved (no agent or session, as
 * on a chat to terminal to chat toggle) the pin is left alone, so a move seen across the gap still counts.
 */
export function nextTranscriptPathPin(
  pin: TranscriptPathPin,
  sessionKey: string,
  starved: boolean,
  transcriptPath: string | null
): TranscriptPathPin {
  if (starved) {
    return pin
  }
  const base = pin.sessionKey === sessionKey ? pin : { sessionKey, pinned: null, moved: null }
  if (transcriptPath === null || transcriptPath === base.pinned) {
    return base
  }
  return { sessionKey, pinned: transcriptPath, moved: base.pinned === null ? base.moved : transcriptPath }
}

/** Why this subscribe ran, for the one log line it leaves (grep logcat for `[native-chat] subscribe`). */
export function subscribeReason(last: SubscribeRun | null, now: SubscribeRun): string {
  if (last === null) {
    return 'first'
  }
  if (last.identity !== now.identity) {
    const [lastSource, lastAgent, lastSession] = JSON.parse(last.identity) as (string | null)[]
    const [nowSource, nowAgent, nowSession] = JSON.parse(now.identity) as (string | null)[]
    if (lastSource !== nowSource || lastAgent !== nowAgent) {
      return 'new-source'
    }
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

/** `none`, `same` (the file is named for this session, as Claude and Codex name theirs) or `other`:
 *  neither a directory nor the file's own name, which would undo the short session id in the log. */
export function pathRelation(path: string | null, sessionId: string | null): string {
  const name = path?.split(/[\\/]/).pop()
  if (!name) {
    return 'none'
  }
  return sessionId !== null && name.replace(/\.jsonl$/, '').endsWith(sessionId) ? 'same' : 'other'
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
  const logBase = `[native-chat] subscribe session=${(args.sessionId ?? '').slice(0, 8)} agent=${args.agent} path=${pathRelation(run.readPath, args.sessionId)} limit=${requested} reason=${subscribeReason(last, run)}`
  return { keepRows, requested, logBase }
}
