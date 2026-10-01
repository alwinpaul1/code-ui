import { AGENT_STATUS_MAX_FIELD_LENGTH } from '../../../src/shared/agent-status-field-normalization'
import { AGENT_STATE_HISTORY_MAX } from '../../../src/shared/agent-status-types'
import { isKnownHarnessInjectedUserTurnText } from '../../../src/shared/harness-injected-user-turns'
import type { DesktopPrompt } from './agent-hud-beacon'

type HarnessStartedPlacement = NonNullable<DesktopPrompt['ifHarnessStarted']>
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
 * and is drawn as cut unless the prompt hook's copy of it carries the rest,
 * desktop-prompt-merge.ts), and the queue itself is not in the status, so the
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
  /** Set on the row Orca lands for a SessionStart (startup, resume, clear):
   *  the pane's prompt was reset. */
  sessionBoundary?: boolean | null
} | null

export type AgentStatusPromptState = {
  /** The session the prompts belong to; a new session starts over. */
  sessionKey: string | null
  /** Whether a status of this session has been read. The prompt on the first
   *  one was there before the chat looked; one that changes after it arrived
   *  while the chat watched. A missing status is not a reading. */
  read: boolean
  /** The last prompt text seen, so a status ping that repeats it (tool
   *  events keep the field) does not become a second bubble. A status with
   *  no prompt leaves it as it was. */
  last: string | null
  /** The `updatedAt` of the last status read that said what prompt the pane
   *  had: one carrying a prompt, or one saying it had none (statusReadsPrompt).
   *  A prompt first seen on the first read after a reconnect came after it. */
  readAt?: number
  prompts: readonly DesktopPrompt[]
  /** How many nonces this session has given out, to held and drawn prompts
   *  alike: the last part of the next one. Never cut with `prompts`
   *  (PROMPT_CAP). Numbered by the list's length, every prompt past the cap
   *  got the same number as the one before it, so two placed by the same run
   *  start, or any two held back, shared a nonce, which the echoes key
   *  everything by (review of 2026-09-30). A new session starts it over, as
   *  it does the list. */
  issued: number
  /** The subagent messages the status carried, in the order it did: never
   *  desktop prompts, but the only words of one a tab without the prompt
   *  hook gets (parseStatusSubagentPreview). */
  agentMessages?: readonly StatusSubagentMessage[]
  /** The line the chat logs for the last prompt it held back, or null when
   *  none was. */
  withheld: string | null
  /** The line the chat logs for the last prompt it drew: which clock placed
   *  it, and whether the chat watched it arrive. */
  placed?: string | null
  /** Set while the first reading (of the session, or since a reconnect or
   *  the cached tab list) was Orca's stand-in, which says nothing about the
   *  prompt, until a status that does: with the bound a prompt found then
   *  cannot be older than, after a reconnect. */
  standIn?: { notBefore?: number; at: number }
}

export const EMPTY_AGENT_STATUS_PROMPTS: AgentStatusPromptState = {
  sessionKey: null,
  read: false,
  last: null,
  prompts: [],
  issued: 0,
  withheld: null
}

/** Bounded: what the chat can still anchor; older ones are in the transcript. */
const PROMPT_CAP = 64

/** Starts the nonce of every prompt read off the tab status, which tells it
 *  from the beacon's copy of the same submission (desktop-prompt-own-sends.ts). */
export const STATUS_PROMPT_NONCE_PREFIX = 'status:'

/** Whether a tab status carries a prompt. */
function statusCarriesPrompt(
  status: AgentStatusPromptSource | undefined
): status is NonNullable<AgentStatusPromptSource> & { prompt: string } {
  return typeof status?.prompt === 'string' && status.prompt.trim().length > 0
}

/**
 * Whether a tab status says anything about the pane's prompt: one that
 * carries a prompt, or one that says the pane has none. That is the row Orca
 * lands for a SessionStart (`sessionBoundary`), and a hook row with a history
 * of its own on a pane whose cached prompt is empty (after startup, resume or
 * clear, in a turn a teammate's message started). Not a tab snapshot with no
 * status, and not Orca's stand-in for a hook row it will not use:
 * `prompt: ''`, `stateHistory: []`, working, blocked or done as the terminal
 * title says, never a session boundary (`buildTitleOnlyStatus` in
 * runtime-mobile-agent-status-projection.ts, runtime-mobile-agent-status-builder.ts,
 * the idle-title branch of runtime-mobile-session-projection.ts, origin/main
 * 8d6fec597b; see observeAgentStatusPrompt).
 *
 * What it cannot tell: Orca's headless builder, and its PTY builder when the
 * renderer published no status, send live hook rows with no history, so
 * there a teammate's turn's rows with no prompt read as the stand-in. After a
 * SessionStart the phone read, that costs nothing (the boundary did the
 * reset); with that row missed, the same words sent again mid-turn in such a
 * turn are taken for the prompt read before and not drawn. Taking every such
 * row as a reset instead would draw a second copy of a message after each
 * long tool call, when Orca's title stands in mid-turn.
 */
function statusReadsPrompt(status: AgentStatusPromptSource | undefined): boolean {
  return (
    statusCarriesPrompt(status) ||
    (status != null && (status.sessionBoundary === true || (status.stateHistory?.length ?? 0) > 0))
  )
}

/**
 * Whether a prompt on the tab status may be Orca's cut of a longer one. Orca
 * cuts the field at AGENT_STATUS_MAX_FIELD_LENGTH characters, one fewer when
 * the cut would leave half an emoji (`truncatePreservingSurrogates`,
 * src/shared/agent-status-field-normalization.ts). A copy cut at 199 read as
 * whole matched neither the phone's send of the message nor its row, and the
 * message was drawn twice. A whole prompt of exactly 199 characters is read
 * as cut too, which only lets it match a row or send that goes on past it.
 */
export function statusCopyMayBeCut(text: string): boolean {
  return text.length >= AGENT_STATUS_MAX_FIELD_LENGTH - 1
}

export function observeAgentStatusPrompt(
  state: AgentStatusPromptState,
  sessionKey: string | null,
  status: AgentStatusPromptSource | undefined,
  /** `firstRead`: the first status the phone has read since it reconnected,
   *  or since the tab list the last visit cached, which, like the first of a
   *  session, can carry a copy minutes old (use-agent-status-prompts.ts). */
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
    state = { sessionKey, read: false, last: state.last, prompts: [], issued: 0, agentMessages: [], withheld: null }
  }
  if (sessionKey === null) {
    return state
  }
  // The chat can mount before the tab's status reaches it; the prompt on the
  // first status it does read was already there all the same. Orca's stand-in
  // counts as that first read, though it says nothing about the prompt, so a
  // message it hid, taken before the chat opened, reads as watched on the
  // next status (gap C of the final review of fix/midturn-prompt-at-end). Not
  // counting it timed a message typed after the chat opened by its run's
  // start instead, and one whose run began on a page not loaded was drawn
  // nowhere (the review of fix/midturn-gaps). So the copy keeps both clocks
  // (`standIn`, `foundAt` below), and the prompt hook's copy of it decides
  // where the tab has the hook; without it, the ping places it: drawn late
  // beats not drawn.
  const firstOfSession = !state.read && status != null
  const readBefore = state.readAt
  const text = typeof status?.prompt === 'string' ? status.prompt : ''
  // Some statuses say nothing about the pane's prompt: a tab snapshot with no
  // status on it (a relay re-dial, a tab list coming back), and Orca's own
  // stand-in when it will not use its hook row (a stale row, or a terminal
  // title that is not the agent's: `prompt: ''`, no history;
  // runtime-mobile-agent-status-builder.ts and the idle-title branch of
  // runtime-mobile-session-projection.ts, origin/main 8d6fec597b). Read as a
  // pane reset, one cleared `last`, and the pane's prompt on the next status
  // became a second copy of a message already drawn: timed by the last status
  // read before a reconnect, the turn's `done`, it drew under the reply that
  // answered it (device, 2026-09-29). Its stamp is no bound on a prompt either
  // (`notBefore` below): the prompt may have been there all along. A hook row
  // that carries no prompt does say the pane had none (statusReadsPrompt).
  const carriesPrompt = statusCarriesPrompt(status)
  const readsPrompt = statusReadsPrompt(status)
  const readAt =
    readsPrompt && typeof status?.updatedAt === 'number' && Number.isFinite(status.updatedAt) ? status.updatedAt : readBefore
  if (firstOfSession || (status != null && readAt !== readBefore)) {
    state = { ...state, read: true, ...(readAt !== undefined ? { readAt } : {}) }
  }
  // Nor did it watch the first status after a reconnect arrive: a prompt taken
  // while the link was down came unseen, and the reconnect restamped
  // `updatedAt` (use-agent-status-prompts.ts). Nor the host's first status
  // after one the tab list the last visit cached: a prompt taken while the
  // chat was closed came unseen, and that status's `updatedAt` is its last
  // tool ping, which drew it at the tail (device, 2026-09-27).
  const found = firstOfSession || (options.firstRead === true && status != null)
  // Orca's stand-in as that first reading used it up, and the prompt on the
  // next status that says what it is may have been there before the chat
  // looked or have come since (gap C of the final review of
  // fix/midturn-prompt-at-end). The copy keeps both clocks (`foundAt`), and the
  // prompt hook's copy of it, where the tab has the hook, decides
  // (use-desktop-prompt-echoes.ts).
  const standIn = state.standIn
  if (found && status != null && !readsPrompt) {
    state = { ...state, standIn: { at: Date.now(), ...(firstOfSession || readBefore === undefined ? {} : { notBefore: readBefore }) } }
  } else if (readsPrompt && standIn !== undefined) {
    state = { ...state, standIn: undefined }
  }
  if (!carriesPrompt) {
    // A pane with no prompt: the next prompt is new even if it repeats the
    // last text.
    return readsPrompt && state.last !== null ? { ...state, last: null } : state
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
    const message = parseStatusSubagentPreview(text, statusCopyMayBeCut(text))
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
  const why =
    typeof run === 'string'
      ? run
      : typeof run === 'object' && run !== null
        ? "it was carried past the end of a turn; it is placed only if the transcript shows a teammate's or another session's message started the turn after"
        : null
  if (why !== null) {
    const held: DesktopPrompt = {
      nonce: `${STATUS_PROMPT_NONCE_PREFIX}${sessionKey}:x:${state.issued}`,
      text,
      ...(statusCopyMayBeCut(text) ? { cut: true } : {}),
      heldBack: true,
      ...(typeof run === 'object' && run !== null ? { ifHarnessStarted: run } : {}),
      seenAt: Date.now()
    }
    return {
      ...state,
      last: text,
      prompts: [...state.prompts, held].slice(-PROMPT_CAP),
      issued: state.issued + 1,
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
  // After a reconnect, no earlier than the last status read before the drop
  // that said what prompt the pane had: the prompt came after it, and the run
  // can have begun an hour before (review of a615bde2). The same after the tab
  // list the last visit cached: the last status read before is that visit's.
  const notBefore = !firstOfSession && options.firstRead === true ? readBefore : undefined
  const runStart = typeof run === 'number' ? Math.max(run, notBefore ?? run) : null
  const byStateStart =
    runStart !== null || (found && typeof status?.stateStartedAt === 'number' && Number.isFinite(status.stateStartedAt))
  const clock = runStart ?? (byStateStart ? status?.stateStartedAt : status?.updatedAt)
  const at = typeof clock === 'number' && Number.isFinite(clock) ? clock : null
  const foundRun = !found && standIn !== undefined && status?.state === 'working' ? runItCameIn(status) : null
  const foundAt = typeof foundRun === 'number' ? Math.max(foundRun, standIn?.notBefore ?? foundRun) : undefined
  const prompt: DesktopPrompt = {
    nonce: `${STATUS_PROMPT_NONCE_PREFIX}${sessionKey}:${at ?? 'x'}:${state.issued}`,
    text,
    ...(statusCopyMayBeCut(text) ? { cut: true } : {}),
    ...(at !== null ? { at } : {}),
    ...(foundAt !== undefined && standIn !== undefined ? { foundAt, standInAt: standIn.at } : {}),
    // The row that carries a prompt is never timed before the prompt was
    // taken; a state's start can be (desktop-prompt-photo-copies.ts).
    ...(byStateStart ? { atStateStart: true as const } : {}),
    // A photo send's own hook copy is never one the phone read before the
    // send (desktop-prompt-photo-copies.ts).
    seenAt: Date.now()
  }
  const prompts = [...state.prompts, prompt].slice(-PROMPT_CAP)
  const clockName =
    typeof run === 'number'
      ? notBefore !== undefined && notBefore > run
        ? 'the last status read before it that said what prompt the pane had'
        : 'the start of the run it came in'
      : byStateStart
        ? "the start of the pane's state"
        : 'its status stamp'
  // Which prompt the reader held when this one came, so the line for a copy
  // of a message it had already drawn shows what it had lost (2026-09-29).
  const before = state.last === null ? 'no prompt read before it' : `after "${preview(state.last)}"`
  const how = found
    ? firstOfSession
      ? "found on the chat's first status"
      : `found on the first status since a reconnect or the cached tab list, ${before}`
    : foundAt !== undefined
      ? `on the first status after Orca's stand-in, found or watched arriving, its run begun ${new Date(foundAt).toISOString()}`
      : 'watched arriving'
  const placed = `[desk-prompt] drawn: "${preview(text)}" (${how}) placed from ${at === null ? 'no time, at the tail' : `${new Date(at).toISOString()}, ${clockName}`}`
  // The subagent messages stay (`...state`): dropping them here took the
  // words off a "Message from" row the moment the person replied (review of
  // 2026-09-27).
  return { ...state, last: text, prompts, issued: state.issued + 1, placed }
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
 * A `done` that carried it means the prompt outlived a turn, and the next was
 * started by something that keeps the cached prompt: a teammate's or another
 * session's message (76ba8f2f, 14:27:03), a subagent's hand-back, or the same
 * words sent again. The status cannot tell those apart, so the walk goes on
 * but only as a candidate (`crossings`): placed if the transcript shows a
 * harness message started each next run (desk-prompt-harness-turns.ts), held
 * otherwise. It stops when the walk reaches the start of a full history
 * (AGENT_STATE_HISTORY_MAX): the run it came in may have been dropped.
 */
function runItCameIn(status: NonNullable<AgentStatusPromptSource>): number | HarnessStartedPlacement | string {
  const history = status.stateHistory ?? []
  const entries = [...history, { state: status.state ?? '', prompt: status.prompt ?? '', startedAt: status.stateStartedAt }]
  const crossings: { after: number; before: number }[] = []
  let first = entries.length - 1
  while (first > 0 && entries[first - 1]!.prompt === status.prompt) {
    const previous = entries[first - 1]!
    if (previous.state === 'done') {
      const after = previous.startedAt
      const before = entries[first]!.startedAt
      if (typeof after !== 'number' || typeof before !== 'number' || !Number.isFinite(after) || !Number.isFinite(before)) {
        return 'it was carried past the end of a turn, which a harness message or the same words sent again then started'
      }
      crossings.unshift({ after, before })
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
  return crossings.length > 0 ? { at: entry.startedAt, crossings } : entry.startedAt
}

/** The start of a prompt, for the log line. Counted and cut in code points,
 *  so the cut never leaves half an emoji at the end of the line. */
function preview(text: string): string {
  const points = Array.from(text)
  return points.length > 32 ? `${points.slice(0, 32).join('')}…` : text
}
