import { createPersistedMap } from './session-cache-persistence'
import type { NativeChatKeptSession, NativeChatTurn } from './native-chat-kept-session'

/**
 * The kept-session store's state, apart from its React hooks
 * (native-chat-kept-session-store.ts) so the test setup can reset it between
 * cases without loading the hooks' imports (vitest.setup.ts).
 */

// Why persisted: a nested agent's status outlives the phone. Restarted while
// the pane still carries it, the chat's first status is the nested one, and
// only the session kept on the last run says which is the tab's own
// (native-chat-kept-session.ts). Bounded like the other per-tab stores.
const kept = createPersistedMap<NativeChatKeptSession>({
  storageKey: 'codeui:chat-kept-session',
  maxEntries: 64
})
/** Each session's turn as last heard, by agent and session id: whether it
 *  runs a tool now, whether it has finished a turn, and whether it started
 *  another after that. Not persisted: after a restart nothing is known, and
 *  nothing known is not evidence of a running turn (native-chat-kept-session.ts). */
export type TurnRecord = { turn: NativeChatTurn; finished: boolean; secondTurn: boolean }
const turns = new Map<string, TurnRecord>()
const TURNS_KEPT = 128
const listeners = new Set<() => void>()

export function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** One entry per host, tab and agent: a Codex later started in the same tab
 *  keeps nothing of the Claude that ran there before it. */
export function nativeChatKeptSessionKey(hostId: string | null, tabId: string, agent: string): string {
  return `${hostId ?? ''}\u0000${tabId}\u0000${agent}`
}

/** What storage holds is checked, not trusted: a corrupt entry is no entry. */
export function keptSession(key: string | null): NativeChatKeptSession | null {
  if (key === null) {
    return null
  }
  const value = kept.get(key)
  return value && typeof value.sessionId === 'string' && typeof value.transcriptPath === 'string' ? value : null
}

export function keepNativeChatSession(key: string, session: NativeChatKeptSession): void {
  const current = keptSession(key)
  if (current?.sessionId === session.sessionId && current.transcriptPath === session.transcriptPath) {
    return
  }
  kept.set(key, session)
  notify()
}

export function turnKey(agent: string, sessionId: string): string {
  return `${agent}\u0000${sessionId}`
}

export function noteTurn(
  agent: string,
  sessionId: string,
  turn: NativeChatTurn,
  finishedOne: boolean,
  fromStandIn = false
): void {
  const key = turnKey(agent, sessionId)
  const previous = turns.get(key)
  if (fromStandIn && turn === 'background' && previous?.turn === 'ended') {
    // A hook row already said the turn ended with nothing left (the
    // all-clear `done`, which keeps the turn's stamp on the tab): Orca's
    // title stand-in after it says nothing about background work.
    return
  }
  const next: TurnRecord = {
    turn,
    finished: previous?.finished === true || finishedOne,
    secondTurn: previous?.secondTurn === true || (previous?.finished === true && turn === 'working')
  }
  if (previous?.turn === next.turn && previous.finished === next.finished && previous.secondTurn === next.secondTurn) {
    return
  }
  turns.delete(key)
  turns.set(key, next)
  while (turns.size > TURNS_KEPT) {
    turns.delete(turns.keys().next().value!)
  }
  notify()
}

/**
 * A Codex rollout's own word on its turn, from a stream frame: Orca reads the
 * newest turn marker in each window it sends (`lifecycle`,
 * transcript-turn-lifecycle.ts), from Codex's explicit task-started and
 * task-complete events. Claude's markers are not used: Orca reads any Claude
 * row with prose or thinking and no stop reason as `completed`, and Claude
 * writes a turn one block per row, so the note before a tool call read as
 * the end of the turn (review of b97b00d6). Frames with none change nothing.
 */
export function noteNativeChatTranscriptTurn(
  agent: string | null,
  sessionId: string | null,
  lifecycle: { state?: unknown } | null | undefined
): void {
  const state = lifecycle?.state
  if (agent !== 'codex' || !sessionId || typeof state !== 'string') {
    return
  }
  if (state === 'working') {
    noteTurn(agent, sessionId, 'working', false)
  } else if (state === 'completed' || state === 'interrupted') {
    noteTurn(agent, sessionId, 'ended', true)
  }
}

/** What else the phone knows about a status, for the turn it says. */
export type StatusTurnEvidence = {
  /** The tab's `turnCompletedAt`: Orca's word that the lead's turn ended
   *  while background work kept the pane `working`. */
  turnCompletedAt?: number | null
  /** The status is Orca's title stand-in (agent-status-stand-in.ts) that
   *  copied the row's identity: its `done` is the title's, not the host's. */
  titleStandIn?: boolean
}

/** A session's own status on the turn: running a tool while `working`; its
 *  turn over with background work still running (`monitoring`, or `working`
 *  under Orca's turn end, which a title stand-in's `done` hides); not while
 *  it waits on a dialog, where no tool runs. A `done` that is not a session
 *  boundary is a finished turn. */
export function statusTurn(
  state: string | null | undefined,
  workingMode: string | null | undefined,
  sessionBoundary: boolean | null | undefined,
  evidence: StatusTurnEvidence = {}
): { turn: NativeChatTurn; finishedOne: boolean; fromStandIn: boolean } | null {
  const gated = evidence.turnCompletedAt != null
  const fromStandIn = evidence.titleStandIn === true
  if (state === 'working') {
    return workingMode === 'monitoring' || gated
      ? { turn: 'background', finishedOne: true, fromStandIn }
      : { turn: 'working', finishedOne: false, fromStandIn }
  }
  if (state === 'blocked' || state === 'waiting') {
    return { turn: 'ended', finishedOne: false, fromStandIn }
  }
  if (state !== 'done') {
    return null
  }
  if (sessionBoundary !== true && gated && fromStandIn) {
    return { turn: 'background', finishedOne: true, fromStandIn }
  }
  return { turn: 'ended', finishedOne: sessionBoundary !== true, fromStandIn }
}

export function readTurn(agent: string, sessionId: string): TurnRecord | null {
  return turns.get(turnKey(agent, sessionId)) ?? null
}

export async function hydrateNativeChatKeptSessions(): Promise<void> {
  await kept.hydrate()
  notify()
}

export function resetNativeChatKeptSessionsForTests(): void {
  kept.reset()
  turns.clear()
  notify()
}
