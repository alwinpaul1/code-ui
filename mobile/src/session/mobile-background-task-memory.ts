import type { AgentStatusEntry, AgentStatusState } from '../../../src/shared/agent-status-types'
import type { PendingAgentCall, WindowTaskEvidence } from './mobile-background-task-evidence'
import type { HeldShellCount } from './mobile-background-task-footer'
import type { RosterRow } from './mobile-background-task-roster'
import { rememberFinishedTaskIds } from './mobile-finished-task-id-memory'

// ─── What the phone has seen of a session's background work, kept ───────────
//
// Every source the running-task reader weighs is a window: the loaded page of
// the transcript slides, the roster can be absent from one snapshot, the
// agent's footer leaves the screen under a dialog. A task a source retired, or
// placed, must not flip back the moment that source looks away. So what each
// one proved is folded in here, per session, for as long as the app runs.
//
// Placing a roster row. Orca's `startedAt` is when ORCA first saw a row, which
// can be hours after the agent started (the four long agents of 967668df read
// 23:07; they launched from 19:31), so it proves little. A row is placed once,
// the first time the phone sees it with a window loaded, and is a reviewer
// only when everything that could make it the lead's is ruled out:
//   - the lead's transcript launched or messaged it: the lead's own;
//   - an unanswered foreground Agent call of the lead's, made up to 30 s
//     before the row started: the lead's own (a foreground agent has no id
//     anywhere until it ends), one row per call, earliest first;
//   - the benefit of the doubt, until it stops, when the phone cannot tell:
//     it was on the first roster the phone read; it arrived with a
//     description (Orca rebuilt it from the lead's own task list, or restored
//     it); no other agent was running just before it to have started it; the
//     phone had just lost sight of the session (no status, or an empty
//     window) and got it back less than a minute ago; or it started before
//     the loaded window reaches back to;
//   - otherwise, a reviewer, and it stays one as the window slides.
// A row that stopped and came back was resumed by whoever started it: the
// lead's SendMessage is in its transcript, a subagent's is not (a874 in
// session 967668df, running at the first look, finished at 00:03:54 and was
// resumed by its parent at 00:27:07).
//
// The run boundary. The pane's `stateStartedAt` moves on every state change,
// `waiting` included, so a question the lead asked (967668df, 23:23:06)
// started a "new run" while four agents and a shell ran on. The phone keeps
// the start of the working run after the last `done`: a `waiting` or `blocked`
// it SAW keeps the boundary; a new working start with nothing seen between is
// taken as a missed `done`, the common case (a queued prompt starting the
// moment a turn ends, or the phone on another tab).

export type SessionTaskEvidence = {
  ownAgentIds: readonly string[]
  /** Rows given the benefit of the doubt, until they stop. Null until the
   *  phone first reads this session's roster. */
  preexistingAgentIds: readonly string[] | null
  /** Every roster id already placed; one is never placed twice. */
  placedAgentIds: readonly string[]
  /** Unanswered Agent calls already matched to a row. */
  vouchedCallKeys: readonly string[]
  /** Ids a window showed ending (a notification, a TaskStop). A stopped shell
   *  has no notification at all — bhcfbe9vf, stopped at 00:20:27 — and the
   *  status line's `bg=` and `live=` keep naming it. */
  retiredTaskIds: readonly string[]
  /** The last host status seen, and when (phone clock). */
  lastStatus: { status: AgentStatusEntry; at: number } | null
  /** The last footer count seen, and when (phone clock). */
  lastShellCount: HeldShellCount | null
  /** The last footer count seen while no subagent ran. */
  leadOnlyShellCount: HeldShellCount | null
  lastPane: { state: AgentStatusState; stateStartedAt: number } | null
  /** Undefined until the phone has seen the pane working. */
  runBoundaryAt: number | null | undefined
  /** Whether the last sighting had no status or no window, and when sight
   *  came back after one that did (phone clock). */
  sightLost: boolean
  sightReturnedAt: number | null
}

export const EMPTY_SESSION_TASK_EVIDENCE: SessionTaskEvidence = {
  ownAgentIds: [],
  preexistingAgentIds: null,
  placedAgentIds: [],
  vouchedCallKeys: [],
  retiredTaskIds: [],
  lastStatus: null,
  lastShellCount: null,
  leadOnlyShellCount: null,
  lastPane: null,
  runBoundaryAt: undefined,
  sightLost: false,
  sightReturnedAt: null
}

/** How far before a call the host may stamp the row it started, and how long
 *  after it the row may start and still be that call's. */
const CALL_TO_ROW_SKEW_MS = 2_000
const CALL_TO_ROW_MAX_MS = 30_000
/** How long rows appearing after the phone got sight back are not judged. */
const SIGHT_RECOVERY_MS = 60_000

type Seen = {
  window: WindowTaskEvidence
  agentStatus: AgentStatusEntry | null
  onScreenShellCount: number | null
  now: number
}

/** Folds what the phone sees now into what it has seen. The id lists come
 *  back as the SAME arrays when nothing new arrived, so readers keyed on them
 *  do not recount. */
export function rememberTaskEvidence(previous: SessionTaskEvidence, seen: Seen): SessionTaskEvidence {
  const { window, agentStatus, onScreenShellCount, now } = seen
  const sighted = agentStatus !== null && window.oldestAt !== null
  const sightReturnedAt = sighted && (previous.sightLost || previous.lastStatus === null) ? now : previous.sightReturnedAt
  const working = agentStatus ? (agentStatus.subagents ?? []).filter((row) => row.state !== 'idle') : null
  const placed = working ? placeRows(previous, seen, working, sightReturnedAt) : null
  return {
    ownAgentIds: rememberFinishedTaskIds(previous.ownAgentIds, [...window.ownAgentIds, ...(placed?.own ?? [])]),
    retiredTaskIds: rememberFinishedTaskIds(previous.retiredTaskIds, window.retiredTaskIds),
    preexistingAgentIds: placed ? placed.preexisting : previous.preexistingAgentIds,
    placedAgentIds: placed ? rememberFinishedTaskIds(previous.placedAgentIds, placed.placed) : previous.placedAgentIds,
    vouchedCallKeys: placed ? rememberFinishedTaskIds(previous.vouchedCallKeys, placed.vouched) : previous.vouchedCallKeys,
    lastStatus: agentStatus ? { status: agentStatus, at: now } : previous.lastStatus,
    lastShellCount: onScreenShellCount === null ? previous.lastShellCount : { count: onScreenShellCount, at: now },
    leadOnlyShellCount:
      onScreenShellCount !== null && working !== null && working.length === 0
        ? { count: onScreenShellCount, at: now }
        : previous.leadOnlyShellCount,
    sightLost: !sighted,
    sightReturnedAt,
    ...nextPane(previous, agentStatus)
  }
}

type Placement = { own: string[]; preexisting: readonly string[]; placed: string[]; vouched: string[] }

function placeRows(previous: SessionTaskEvidence, seen: Seen, working: readonly RosterRow[], sightReturnedAt: number | null): Placement {
  const { window, now } = seen
  const own: string[] = []
  const placed: string[] = []
  const vouched: string[] = []
  const usedCalls = new Set(previous.vouchedCallKeys)
  const vouch = (row: RosterRow): boolean => {
    const call = window.pendingAgentCalls.find((candidate) => !usedCalls.has(candidate.key) && callStarted(candidate, row))
    if (!call) {
      return false
    }
    usedCalls.add(call.key)
    vouched.push(call.key)
    own.push(row.id)
    return true
  }
  const byStart = [...working].sort((left, right) => left.startedAt - right.startedAt)
  if (previous.preexistingAgentIds === null) {
    // The first look: every row gets the doubt, and a call whose agent is
    // already up is used by it, so it cannot vouch for a later row.
    byStart.forEach(vouch)
    const ids = working.map((row) => row.id)
    return { own, preexisting: ids, placed: ids, vouched }
  }
  const still = new Set(working.map((row) => row.id))
  const preexisting: string[] = previous.preexistingAgentIds.filter((id) => still.has(id))
  if (window.oldestAt === null) {
    // No window loaded (a re-subscribe starts from an empty list): nothing
    // new is placed until one is.
    return { own, preexisting: sameOrNew(previous.preexistingAgentIds, preexisting), placed, vouched }
  }
  const known = new Set([...previous.placedAgentIds, ...previous.ownAgentIds, ...window.ownAgentIds])
  const before = (previous.lastStatus?.status.subagents ?? []).filter((row) => row.state !== 'idle').map((row) => row.id)
  const recovering = sightReturnedAt !== null && now - sightReturnedAt < SIGHT_RECOVERY_MS
  for (const row of byStart.filter((candidate) => !known.has(candidate.id))) {
    placed.push(row.id)
    if (vouch(row)) {
      continue
    }
    const rebuilt = Boolean(row.description?.trim())
    const noParent = !before.some((id) => id !== row.id)
    if (rebuilt || noParent || recovering || row.startedAt < window.oldestAt) {
      preexisting.push(row.id)
    }
  }
  return { own, preexisting: sameOrNew(previous.preexistingAgentIds, preexisting), placed, vouched }
}

/** A foreground Agent call started this row: the row came up within 30 s of
 *  the call, and names the same agent type when both say one. */
function callStarted(call: PendingAgentCall, row: RosterRow): boolean {
  return (
    call.at !== null &&
    row.startedAt >= call.at - CALL_TO_ROW_SKEW_MS &&
    row.startedAt <= call.at + CALL_TO_ROW_MAX_MS &&
    (call.subagentType === null || !row.agentType || call.subagentType === row.agentType)
  )
}

function sameOrNew(previous: readonly string[], next: readonly string[]): readonly string[] {
  return previous.length === next.length && previous.every((id, index) => id === next[index]) ? previous : next
}

function nextPane(
  previous: SessionTaskEvidence,
  agentStatus: AgentStatusEntry | null
): Pick<SessionTaskEvidence, 'lastPane' | 'runBoundaryAt'> {
  if (agentStatus === null) {
    return { lastPane: previous.lastPane, runBoundaryAt: previous.runBoundaryAt }
  }
  const lastPane = { state: agentStatus.state, stateStartedAt: agentStatus.stateStartedAt }
  const before = previous.lastPane
  if (agentStatus.state !== 'working' || (before?.state === 'working' && before.stateStartedAt === agentStatus.stateStartedAt)) {
    return { lastPane, runBoundaryAt: previous.runBoundaryAt }
  }
  const followsWait = before?.state === 'waiting' || before?.state === 'blocked'
  return { lastPane, runBoundaryAt: followsWait ? (previous.runBoundaryAt ?? null) : agentStatus.stateStartedAt }
}
