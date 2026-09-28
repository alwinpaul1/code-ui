import { nativeChatAgentFromTranscriptPath } from './mobile-native-chat-session-agent'

/**
 * Whose word a tab's status is, for the chat of that tab's agent, and which
 * session the chat reads.
 *
 * A pane's status is the last hook event Orca took for the pane key, and any
 * agent started inside the pane inherits that key. On 2026-09-28 Claude
 * (session 76ba8f2f, `claude -c`, the Thesis tab "paper-review") launched Grok
 * from its own Bash tool through the grok-build bridge. Grok's hooks posted as
 * the pane: the status's session became Grok's 5690de4f, its state `working`,
 * and Orca, which keeps a pane's type while its Claude turn runs, relabelled
 * the row `claude` and suppresses a nested agent's `done`, so it never ended.
 * The chat followed the status to 5690de4f, which has no Claude transcript,
 * and drew nothing but the prompt the status still carried, under a Working
 * row and a Stop that never went away.
 *
 * The phone cannot see which agent posted a status: Orca keeps `source` in its
 * own record and `pickParsedAgentStatusPayload` (src/shared/agent-status-types.ts)
 * leaves it out. What it does get, and what this reads:
 *
 * - The transcript path. Claude Code and Codex name their transcript on every
 *   hook, and Orca keeps it as `providerSession.transcriptPath` for those two
 *   sources only (`extractAgentProviderSession`, src/shared/agent-session-resume.ts,
 *   Orca origin/main 8d6fec597b). Grok's provider session is `{ key, id }`.
 *   A status naming no transcript never moves the chat; one naming another
 *   agent's transcript (a Claude inside a Codex pane) neither.
 * - The turn. A nested agent runs inside a tool call, so it can only appear
 *   while the session the chat reads is running one; a real new session
 *   (`/clear`, a restarted `claude`) starts at an idle prompt. So a new session
 *   that does name its own transcript (a nested `claude -p`, whose hooks look
 *   exactly like a `/clear`'s) does not move the chat while the kept session's
 *   own last status says it is working. Waiting on a dialog, done, or never
 *   heard from (a cold start) is no such evidence. The way out when the kept
 *   session died mid-turn and never said so (Orca installs no SessionEnd for
 *   Claude): the new session starting a second turn, which a nested
 *   `claude -p` never does. Its first finished turn is not enough: Orca only
 *   holds back a nested agent's `done` when its type differs from the pane's
 *   (`resolveAgentStatusIdentity`), so a nested Claude's Stop reaches the
 *   pane. Claude's transcript markers are not turn evidence either: Orca
 *   reads a prose or thinking row with no stop reason as `completed`, and
 *   Claude writes one row per block, so a note before a tool call reads as an
 *   end. A Codex rollout's explicit task events are.
 * - The beacon, where there is one. Claude's status line writes the session
 *   of the process painting the terminal every few seconds. Fresh, it picks
 *   the session over a status naming no transcript, and it allows a switch to
 *   the session it names. A Windows host has none (`hostTakesAgentHudFlag`),
 *   so nothing here depends on it.
 *
 * What a nested status is never, for the chat: its Working row, its Stop, its
 * desk prompts, its model or its tasks. With nothing kept for the tab (the
 * first read ever, or storage lost) and a status naming no transcript, the
 * chat does not guess: it asks for the session as reported, draws none of the
 * status, and the empty state names the likely cause.
 */

/** A session the tab's own agent named, with the transcript it named. */
export type NativeChatKeptSession = {
  sessionId: string
  transcriptPath: string
}

/** Whether a session's lead turn is running a tool, as far as the phone has
 *  heard: only then can an agent be started inside it. */
export type NativeChatTurn = 'working' | 'ended'

export type NativeChatStatusReading =
  /** The chat agent's own status. `keep` is what to remember for the tab,
   *  when the status named a transcript; `switched` says why it moved off the
   *  kept session, when it did. */
  | {
      kind: 'own'
      sessionId: string
      transcriptPath: string | null
      keep: NativeChatKeptSession | null
      switched: { from: string; why: string } | null
    }
  /** A nested agent's status: the chat reads `read` instead, or, with nothing
   *  better (`null`), the status's session with no transcript path. */
  | {
      kind: 'nested'
      nestedSessionId: string
      read: { sessionId: string; transcriptPath: string | null } | null
      reason: NestedReason
    }
  /** No rule applies (another agent, or no session named): as reported. */
  | { kind: 'as-reported' }

type NestedReason =
  | { kind: 'no-transcript' }
  | { kind: 'painting' }
  | { kind: 'other-agent'; writer: 'claude' | 'codex' }
  | { kind: 'mid-turn' }

type ProviderSessionLike = { id?: string | null; transcriptPath?: string | null } | null | undefined

/** Agents whose own hooks name their transcript on every event. */
const NAMES_ITS_TRANSCRIPT: ReadonlySet<string> = new Set(['claude', 'codex'])

export function namesItsTranscript(agent: string | null): boolean {
  return agent !== null && NAMES_ITS_TRANSCRIPT.has(agent)
}

export type NativeChatStatusEvidence = {
  agent: string | null
  providerSession: ProviderSessionLike
  /** The status's state and boundary flag: a `done` that is not a session
   *  boundary is a turn the status's session finished. */
  state?: string | null
  sessionBoundary?: boolean | null
  kept: NativeChatKeptSession | null
  /** The kept session's turn, from its own last status (and a Codex
   *  rollout's task markers); null when nothing has said. */
  keptTurn: NativeChatTurn | null
  /** The status's session has finished a turn and started another: a
   *  nested `claude -p` runs one prompt and exits. */
  secondTurn?: boolean
  /** The session a fresh beacon of the chat agent names on this terminal. */
  painting: string | null
}

export function readNativeChatTabStatus(evidence: NativeChatStatusEvidence): NativeChatStatusReading {
  const { agent, providerSession, kept, keptTurn, painting } = evidence
  const sessionId = providerSession?.id?.trim() ?? ''
  if (!namesItsTranscript(agent) || sessionId.length === 0) {
    return { kind: 'as-reported' }
  }
  const transcriptOf = (id: string): string | null => (kept?.sessionId === id ? kept.transcriptPath : null)
  const readOwn = (id: string | null) => (id === null ? null : { sessionId: id, transcriptPath: transcriptOf(id) })
  const transcriptPath = providerSession?.transcriptPath?.trim() || null
  const writer = transcriptPath === null ? null : nativeChatAgentFromTranscriptPath(transcriptPath)
  if (transcriptPath === null || (writer !== null && writer !== agent)) {
    // Never the chat's session: no transcript, or another agent's.
    const own = painting ?? kept?.sessionId ?? null
    if (own === sessionId) {
      return { kind: 'own', sessionId, transcriptPath: transcriptOf(sessionId), keep: null, switched: null }
    }
    const reason: NestedReason =
      writer !== null && writer !== agent
        ? { kind: 'other-agent', writer }
        : painting !== null && painting !== kept?.sessionId
          ? { kind: 'painting' }
          : { kind: 'no-transcript' }
    return { kind: 'nested', nestedSessionId: sessionId, read: readOwn(own), reason }
  }
  const keep = { sessionId, transcriptPath }
  if (painting !== null && painting !== sessionId) {
    // The process painting the terminal is another session: this one runs
    // inside it, kept or not.
    return { kind: 'nested', nestedSessionId: sessionId, read: readOwn(painting), reason: { kind: 'painting' } }
  }
  if (kept === null || kept.sessionId === sessionId) {
    return { kind: 'own', sessionId, transcriptPath, keep, switched: null }
  }
  // A different session, naming its own transcript: a /clear, a restart, or a
  // nested run of the same agent, which can only start while the kept session
  // runs a tool. Nothing saying so (a cold start) is not evidence of it.
  const why =
    painting === sessionId
      ? `the ${agent} beacon on this terminal names it`
      : keptTurn === 'ended'
        ? `${shortSessionId(kept.sessionId)}'s turn had ended`
        : keptTurn === null
          ? `nothing said ${shortSessionId(kept.sessionId)} was mid-turn`
          : evidence.secondTurn === true
            ? 'it started a second turn of its own'
            : null
  if (why !== null) {
    return { kind: 'own', sessionId, transcriptPath, keep, switched: { from: kept.sessionId, why } }
  }
  return { kind: 'nested', nestedSessionId: sessionId, read: readOwn(kept.sessionId), reason: { kind: 'mid-turn' } }
}

/** The first eight characters: enough to tell two sessions apart in a log and
 *  to find one in the desktop's records. */
export function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8)
}

/**
 * The one line the chat logs when a status did not simply decide its
 * session, or null when it did. Grep logcat for `[native-chat] kept session`,
 * `[native-chat] switched session` and `[native-chat] no … session kept`.
 */
export function nativeChatStatusReadingLogLine(agent: string | null, reading: NativeChatStatusReading): string | null {
  if (reading.kind === 'own') {
    return reading.switched
      ? `[native-chat] switched session ${shortSessionId(reading.switched.from)} to ${shortSessionId(reading.sessionId)}: ${reading.switched.why}`
      : null
  }
  if (reading.kind !== 'nested') {
    return null
  }
  const nested = shortSessionId(reading.nestedSessionId)
  if (reading.read === null) {
    return `[native-chat] no ${agent} session kept for this tab; ${nested}'s status named no ${agent} transcript (a nested agent's, most likely), so the chat draws none of it and reads ${nested} as reported`
  }
  const kept = shortSessionId(reading.read.sessionId)
  const why =
    reading.reason.kind === 'no-transcript'
      ? 'the new session named no transcript'
      : reading.reason.kind === 'painting'
        ? `the ${agent} beacon on this terminal names ${kept} (a nested agent on this pane)`
        : reading.reason.kind === 'other-agent'
          ? `the new session is a ${reading.reason.writer} transcript, not ${agent}'s (a nested agent on this pane)`
          : `it appeared while ${kept} was mid-turn (a nested agent on this pane)`
  return `[native-chat] kept session ${kept} over ${nested}: ${why}`
}

/** The session a chat reads, and the one a nested agent's status named
 *  instead, when one did (so the empty state can say why it is not read). */
export type NativeChatSessionIdentity = {
  sessionId: string | null
  transcriptPath: string | null
  nestedSessionId: string | null
}
