import type { AgentStatusEntry, AgentStatusState } from '../../../src/shared/agent-status-types'
import type { PendingAgentCall, WindowTaskEvidence } from './mobile-background-task-evidence'
import type { HeldShellCount } from './mobile-background-task-footer'
import { isTeammateLifecycleId, type RosterRow } from './mobile-background-task-roster'
import { rememberFinishedTaskIds } from './mobile-finished-task-id-memory'
import { isOrcaStandIn } from './agent-status-stand-in'

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
//     it was on the first roster the phone read; no other agent was running
//     to have started it (none on the roster before it, none on this one
//     started earlier); or it started before the loaded window reaches back
//     to;
//   - otherwise, a reviewer, and it stays one as the window slides.
// Rows are placed only on a SETTLED transcript: back on a tab the chat first
// paints the tail it cached when the user left, which does not hold what the
// lead launched meanwhile. Not on a description: Orca's fold writes one from
// `background_tasks`, which lists every subagent, reviewers included. Not on
// a status blip or the first minute after opening either — a window that is
// settled holds every launch since its oldest row whenever it is read.
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
  /** Each doubted row's start when it got the doubt. Orca drops a stopped
   *  subagent's row and starts it afresh, so a row back with another start
   *  stopped and was resumed while the phone did not see it, and the doubt
   *  does not follow it. A teammate's row keeps its start across a stop. */
  doubtStartedAt: Readonly<Record<string, number>>
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
}

export const EMPTY_SESSION_TASK_EVIDENCE: SessionTaskEvidence = {
  ownAgentIds: [],
  preexistingAgentIds: null,
  doubtStartedAt: {},
  placedAgentIds: [],
  vouchedCallKeys: [],
  retiredTaskIds: [],
  lastStatus: null,
  lastShellCount: null,
  leadOnlyShellCount: null,
  lastPane: null,
  runBoundaryAt: undefined
}

/** How far before a call the host may stamp the row it started, and how long
 *  after it the row may start and still be that call's. */
const CALL_TO_ROW_SKEW_MS = 2_000
const CALL_TO_ROW_MAX_MS = 30_000

type Seen = {
  window: WindowTaskEvidence
  /** Whether `window` is the settled read, not a cached tail painted while
   *  the fresh one loads. */
  settled: boolean
  agentStatus: AgentStatusEntry | null
  onScreenShellCount: number | null
  now: number
}

/** Folds what the phone sees now into what it has seen. The id lists come
 *  back as the SAME arrays when nothing new arrived, so readers keyed on them
 *  do not recount. */
export function rememberTaskEvidence(previous: SessionTaskEvidence, seen: Seen): SessionTaskEvidence {
  const { window, agentStatus, onScreenShellCount, now } = seen
  // Orca's title stand-in carries no roster, which is not a roster with no one
  // on it (agent-status-stand-in.ts): read as one, every row lost the benefit
  // of the doubt and stayed hidden once a hook row listed it again.
  const working =
    agentStatus && !isOrcaStandIn(agentStatus) ? (agentStatus.subagents ?? []).filter((row) => row.state !== 'idle') : null
  const placed = working ? placeRows(previous, seen, working) : null
  return {
    ownAgentIds: rememberFinishedTaskIds(previous.ownAgentIds, [...window.ownAgentIds, ...(placed?.own ?? [])]),
    retiredTaskIds: rememberFinishedTaskIds(previous.retiredTaskIds, window.retiredTaskIds),
    preexistingAgentIds: placed ? placed.preexisting : previous.preexistingAgentIds,
    doubtStartedAt: placed ? placed.doubtStartedAt : previous.doubtStartedAt,
    placedAgentIds: placed ? rememberFinishedTaskIds(previous.placedAgentIds, placed.placed) : previous.placedAgentIds,
    vouchedCallKeys: placed ? rememberFinishedTaskIds(previous.vouchedCallKeys, placed.vouched) : previous.vouchedCallKeys,
    lastStatus: agentStatus ? { status: agentStatus, at: now } : previous.lastStatus,
    lastShellCount: onScreenShellCount === null ? previous.lastShellCount : { count: onScreenShellCount, at: now },
    leadOnlyShellCount:
      onScreenShellCount !== null && working !== null && working.length === 0
        ? { count: onScreenShellCount, at: now }
        : previous.leadOnlyShellCount,
    ...nextPane(previous, agentStatus)
  }
}

type Placement = {
  own: string[]
  preexisting: readonly string[]
  doubtStartedAt: Readonly<Record<string, number>>
  placed: string[]
  vouched: string[]
}

function placeRows(previous: SessionTaskEvidence, seen: Seen, working: readonly RosterRow[]): Placement {
  const { window } = seen
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
    return { own, preexisting: ids, doubtStartedAt: startsOf(working), placed: ids, vouched }
  }
  const startOf = new Map(working.map((row) => [row.id, row.startedAt]))
  // Still running, and the same run: a row that stopped unseen and came back
  // with a new start was resumed by whoever started it, and a subagent's
  // resume is not in the lead's transcript.
  const sameRun = (id: string): boolean => {
    const doubtedAt = previous.doubtStartedAt[id]
    return startOf.has(id) && (isTeammateLifecycleId(id) || doubtedAt === undefined || doubtedAt === startOf.get(id))
  }
  const preexisting: string[] = previous.preexistingAgentIds.filter(sameRun)
  const oldestAt = window.oldestAt
  if (oldestAt === null || !seen.settled) {
    // No settled window (a re-subscribe starts from an empty list, then paints
    // the cached tail): nothing new is placed until the fresh read lands.
    return withDoubtStarts(previous, { own, preexisting: sameOrNew(previous.preexistingAgentIds, preexisting), placed, vouched }, startOf)
  }
  const known = new Set([...previous.placedAgentIds, ...previous.ownAgentIds, ...window.ownAgentIds])
  const before = (previous.lastStatus?.status.subagents ?? []).filter((row) => row.state !== 'idle').map((row) => row.id)
  for (const row of byStart.filter((candidate) => !known.has(candidate.id))) {
    placed.push(row.id)
    if (vouch(row)) {
      continue
    }
    const parent = before.some((id) => id !== row.id) || working.some((other) => other.id !== row.id && other.startedAt < row.startedAt)
    if (!parent || row.startedAt < oldestAt) {
      preexisting.push(row.id)
    }
  }
  return withDoubtStarts(previous, { own, preexisting: sameOrNew(previous.preexistingAgentIds, preexisting), placed, vouched }, startOf)
}

function startsOf(rows: readonly RosterRow[]): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.id, row.startedAt]))
}

/** The placement with each doubted row's start: the one it was doubted with,
 *  or this roster's for a row doubted now. The same object when the doubted
 *  rows did not change. */
function withDoubtStarts(
  previous: SessionTaskEvidence,
  placement: Omit<Placement, 'doubtStartedAt'>,
  startOf: ReadonlyMap<string, number>
): Placement {
  if (placement.preexisting === previous.preexistingAgentIds) {
    return { ...placement, doubtStartedAt: previous.doubtStartedAt }
  }
  const doubtStartedAt: Record<string, number> = {}
  for (const id of placement.preexisting) {
    const at = previous.doubtStartedAt[id] ?? startOf.get(id)
    if (at !== undefined) {
      doubtStartedAt[id] = at
    }
  }
  return { ...placement, doubtStartedAt }
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
