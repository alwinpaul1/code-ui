import { AGENT_STATUS_MAX_FIELD_LENGTH } from '../../../src/shared/agent-status-field-normalization'
import { AGENT_STATE_HISTORY_MAX } from '../../../src/shared/agent-status-types'
import { isKnownHarnessInjectedUserTurnText } from '../../../src/shared/harness-injected-user-turns'
import type { DesktopPrompt } from './agent-hud-beacon'
import { parseStatusSubagentPreview, type StatusSubagentMessage } from './mobile-native-chat-agent-messages'

/**
 * A desktop prompt read off the tab's `agentStatus.prompt`.
 *
 * Orca installs its own Claude Code hooks for every session on the machine
 * (`~/.claude/settings.json`: `UserPromptSubmit` and the rest post to the
 * runtime's hook port), and the session-tab snapshot the phone already
 * subscribes to carries the result: `agentStatus.prompt` is the last prompt
 * the session took, hand-started or not, from whichever client sent it —
 * the desktop, the Claude app, this phone. Read on this machine 2026-09-19
 * for a hand-started session: the prompt the user had just typed on the
 * desktop, while the agent was working.
 *
 * That replaces the transcript tail, which reached the same rows only by
 * opening a `tail -F` terminal on the desktop — a tab the user saw and did
 * not want. What the hook path cannot give: the field is capped at
 * AGENT_STATUS_MAX_FIELD_LENGTH characters (a longer prompt arrives cut,
 * and is drawn as cut), and the queue itself is not in the status, so the
 * queue box reads the screen alone.
 *
 * Nor is the prompt always this turn's. It is the last one a PERSON sent:
 * Orca keeps it through a turn that a message from another session or a
 * teammate starts (`resolvePrompt` keeps the cached prompt for a
 * harness-injected turn, src/shared/agent-hook-listener/prompt-fields.ts) and
 * through the `done` that ends a turn. Session 76ba8f2f's tab still carried
 * a prompt from 13:20 at 23:36, four turns later (2026-09-26).
 */
export type AgentStatusPromptSource = {
  prompt?: string | null
  updatedAt?: number | null
  stateStartedAt?: number | null
  /** The pane's state (`working`, `waiting`, `blocked`, `done`), and the
   *  states before it, one entry per change (Orca's agent-status store): what
   *  says which run `prompt` came in (runItCameIn). Every status a host sends
   *  has a state; only a fixture leaves it out. */
  state?: string | null
  stateHistory?: readonly { state: string; prompt?: string; startedAt?: number }[] | null
  /** The session the row's last hook event came from (Claude `session_id`). */
  providerSession?: { id: string } | null
} | null

export type AgentStatusPromptState = {
  /** The session the prompts belong to; a new session starts over. */
  sessionKey: string | null
  /** Whether a status of this session has been read. The prompt on the first
   *  one was there before the chat looked; one that changes after it arrived
   *  while the chat watched. A missing status is not a reading. */
  read: boolean
  /** The last prompt text seen, so a status ping that repeats it (tool
   *  events keep the field) does not become a second bubble. */
  last: string | null
  /** The `updatedAt` of the last status read. A prompt first seen on the
   *  first read after a reconnect came after it. */
  readAt?: number
  prompts: readonly DesktopPrompt[]
  /** The subagent messages the status carried, in the order it did: never
   *  desktop prompts, but the only words of one a tab without the prompt
   *  hook gets (parseStatusSubagentPreview). */
  agentMessages?: readonly StatusSubagentMessage[]
  /** The line the chat logs for the last prompt it held back, or null when
   *  none was. */
  withheld: string | null
}

export const EMPTY_AGENT_STATUS_PROMPTS: AgentStatusPromptState = {
  sessionKey: null,
  read: false,
  last: null,
  prompts: [],
  withheld: null
}

/** Bounded: what the chat can still anchor; older ones are in the transcript. */
const PROMPT_CAP = 64

/** Starts the nonce of every prompt read off the tab status, which tells it
 *  from the beacon's copy of the same submission (desktop-prompt-own-sends.ts). */
export const STATUS_PROMPT_NONCE_PREFIX = 'status:'

export function observeAgentStatusPrompt(
  state: AgentStatusPromptState,
  sessionKey: string | null,
  status: AgentStatusPromptSource | undefined,
  /** `firstRead`: the first status the phone has read since it reconnected,
   *  which, like the first of a session, can carry a copy minutes old. */
  options: { firstRead?: boolean } = {}
): AgentStatusPromptState {
  if (sessionKey !== state.sessionKey) {
    // The prompts start over; the last TEXT seen does not. The pane caches
    // `prompt` across events, and a hook from another session on the same
    // pane flips `providerSession` there and back — a nested `claude` started
    // from the agent's own Bash tool inherits the terminal's ORCA_PANE_KEY and
    // posts as this pane (2026-09-19). On the way back the row carried that
    // session's text with this session's id, and a reset to null took it as a
    // new prompt of this chat.
    state = { sessionKey, read: false, last: state.last, prompts: [], agentMessages: [], withheld: null }
  }
  if (sessionKey === null) {
    return state
  }
  // The chat can mount before the tab's status reaches it; the prompt on the
  // first status it does read was already there all the same.
  const firstOfSession = !state.read && status != null
  const readBefore = state.readAt
  const readAt = typeof status?.updatedAt === 'number' && Number.isFinite(status.updatedAt) ? status.updatedAt : readBefore
  if (firstOfSession || (status != null && readAt !== readBefore)) {
    state = { ...state, read: true, ...(readAt !== undefined ? { readAt } : {}) }
  }
  // Nor did it watch the first status after a reconnect arrive: a prompt taken
  // while the link was down came unseen, and the reconnect restamped
  // `updatedAt` (use-agent-status-prompts.ts).
  const found = firstOfSession || (options.firstRead === true && status != null)
  const text = typeof status?.prompt === 'string' ? status.prompt : ''
  if (text.trim().length === 0) {
    // Empty is "unknown" or a pane reset: the next prompt is new even if it
    // repeats the last text.
    return state.last === null ? state : { ...state, last: null }
  }
  if (text === state.last) {
    return state
  }
  const owner = status?.providerSession?.id
  if (typeof owner === 'string' && owner.length > 0 && owner !== sessionKey) {
    // Another session's row on this pane. Its prompt is not this chat's, but
    // it is SEEN: the pane will still be carrying the text when it flips back.
    return { ...state, last: text }
  }
  // A message from another session or a subagent fires the same hook as a
  // typed prompt, and its first 200 characters are the injected preamble and
  // an XML tag. The transcript row is drawn as a peer notice; an echo here
  // would be the wrapper, drawn twice (2026-09-20). Seen, not echoed.
  if (isKnownHarnessInjectedUserTurnText(text)) {
    const message = parseStatusSubagentPreview(text, text.length >= AGENT_STATUS_MAX_FIELD_LENGTH)
    // When the phone first read it, which is what pairs it with the screen's
    // row of the same message (screen-peer-notices.ts). Not on a first read
    // (a launch, a return to the tab, a reconnect): that copy can be minutes
    // old with its row off the screen, and timed by the read it paired with
    // the sender's next row and gave it the old words (re-review of
    // 2026-09-27). Kept untimed, it never pairs.
    const live = !found
    const seen = message ? (live ? { ...message, seenAt: Date.now() } : message) : null
    return seen
      ? { ...state, last: text, agentMessages: [...(state.agentMessages ?? []), seen].slice(-PROMPT_CAP) }
      : { ...state, last: text }
  }
  // Found on the first reading, or on a pane that is not working (a
  // submission makes it working), the prompt was already there: its time is
  // the start of the run it came in, as the status's history says
  // (runItCameIn). A prompt the history cannot place is never drawn: placed
  // by a time that is not its own, it sat in another turn (session 76ba8f2f,
  // 2026-09-26: under an answer four turns after it). A transcript row of it
  // draws it where it belongs, when the page that holds it loads. The copy is
  // still kept, untimed, for the pairing: a phone send that is still pending
  // claims its own copy, and without it claimed the desk's next one instead
  // (review of 784531ee).
  const run = typeof status?.state === 'string' && (found || status.state !== 'working') ? runItCameIn(status) : null
  const why = typeof run === 'string' ? run : null
  if (why !== null) {
    const held: DesktopPrompt = {
      nonce: `${STATUS_PROMPT_NONCE_PREFIX}${sessionKey}:x:${state.prompts.length}`,
      text,
      ...(text.length >= AGENT_STATUS_MAX_FIELD_LENGTH ? { cut: true } : {}),
      heldBack: true,
      seenAt: Date.now()
    }
    return {
      ...state,
      last: text,
      prompts: [...state.prompts, held].slice(-PROMPT_CAP),
      withheld: `[desk-prompt] not drawn: "${preview(text)}" was read on a ${status?.state} pane (${why}) and the status holds no time for it; it draws only from a transcript row, which a message sent mid-turn does not have`
    }
  }
  // `updatedAt` is the hook's clock and is the prompt's time only while the
  // phone is watching as the prompt arrives. For the first status a session
  // shows the phone — a tab opened an hour into its turn — it is the last tool
  // ping, and a prompt timed by it anchored at the tail under the tool fold
  // (device, 2026-09-20). The run it came in began at or before it, so that
  // run's start is its time; a status with no state (a fixture) has only its
  // current state's start.
  // After a reconnect, no earlier than the last status read before the drop:
  // the prompt came after it, and the run can have begun an hour before
  // (review of a615bde2).
  const notBefore = !firstOfSession && options.firstRead === true ? readBefore : undefined
  const runStart = typeof run === 'number' ? Math.max(run, notBefore ?? run) : null
  const byStateStart =
    runStart !== null || (found && typeof status?.stateStartedAt === 'number' && Number.isFinite(status.stateStartedAt))
  const clock = runStart ?? (byStateStart ? status?.stateStartedAt : status?.updatedAt)
  const at = typeof clock === 'number' && Number.isFinite(clock) ? clock : null
  const prompt: DesktopPrompt = {
    nonce: `${STATUS_PROMPT_NONCE_PREFIX}${sessionKey}:${at ?? 'x'}:${state.prompts.length}`,
    text,
    ...(text.length >= AGENT_STATUS_MAX_FIELD_LENGTH ? { cut: true } : {}),
    ...(at !== null ? { at } : {}),
    // The row that carries a prompt is never timed before the prompt was
    // taken; a state's start can be (desktop-prompt-photo-copies.ts).
    ...(byStateStart ? { atStateStart: true as const } : {}),
    // A photo send's own hook copy is never one the phone read before the
    // send (desktop-prompt-photo-copies.ts).
    seenAt: Date.now()
  }
  const prompts = [...state.prompts, prompt].slice(-PROMPT_CAP)
  // The subagent messages stay (`...state`): dropping them here took the
  // words off a "Message from" row the moment the person replied (review of
  // 2026-09-27).
  return { ...state, last: text, prompts }
}

/**
 * The start of the working run the status's prompt came in, or why the status
 * cannot say.
 *
 * `prompt` is the last prompt a person sent, and Orca pushes one history entry
 * per state change, each with the prompt the pane carried when that state
 * ended; `stateStartedAt` moves on every change. So the run where the pane
 * first carried the prompt began at or before it was taken: its time, for a
 * prompt that started the run, and a little early, in the same turn, for one
 * sent during it. Walking back over the entries that carry it passes the
 * pauses where the agent asked (`waiting`, `blocked`), which are the same run.
 *
 * It stops at a `done` that carried it: the prompt outlived a turn, and the
 * next was started by something that keeps the cached prompt, a teammate's or
 * another session's message (76ba8f2f, 14:27:03), or by the same words sent
 * again. The status cannot tell those apart. It stops too when the walk
 * reaches the start of a full history (AGENT_STATE_HISTORY_MAX): the run it
 * came in may have been dropped.
 */
function runItCameIn(status: NonNullable<AgentStatusPromptSource>): number | string {
  const history = status.stateHistory ?? []
  const entries = [...history, { state: status.state ?? '', prompt: status.prompt ?? '', startedAt: status.stateStartedAt }]
  let first = entries.length - 1
  while (first > 0 && entries[first - 1]!.prompt === status.prompt) {
    if (entries[first - 1]!.state === 'done') {
      return 'it was carried past the end of a turn, which a harness message or the same words sent again then started'
    }
    first -= 1
  }
  if (first === 0 && history.length >= AGENT_STATE_HISTORY_MAX) {
    return 'the state history no longer reaches the run it came in'
  }
  const entry = entries[first]!
  if (entry.state !== 'working' || typeof entry.startedAt !== 'number' || !Number.isFinite(entry.startedAt)) {
    return 'no working run carried it first'
  }
  return entry.startedAt
}

/** The start of a prompt, for the log line. */
function preview(text: string): string {
  return text.length > 32 ? `${text.slice(0, 32)}…` : text
}
