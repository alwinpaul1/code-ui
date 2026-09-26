import type { AgentStatusEntry, AgentStatusState } from '../../../src/shared/agent-status-types'
import type { WindowTaskEvidence } from './mobile-background-task-evidence'
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
// Placing a roster row. Each row is placed ONCE, the first time the phone sees
// it with a window loaded:
//   - the lead's transcript launched or messaged it: the lead's own;
//   - an Agent call of the lead's still waiting for its result made at or
//     before the row started: the lead's own (a foreground agent, which has no
//     id anywhere until it ends), one row per call, earliest first;
//   - it was on the first roster the phone read, or it started before the
//     loaded window reaches back to: the phone cannot tell, and gives it the
//     benefit of the doubt until it stops;
//   - otherwise the window covers its start and shows no launch: a reviewer
//     one of the lead's agents started. That stays so as the window slides.
// A row that stopped and came back was resumed by whoever started it: the
// lead's SendMessage is in its transcript, a subagent's is not (a874 in
// session 967668df, running at the first look, finished at 00:03:54 and was
// resumed by its parent at 00:27:07).
//
// The run boundary. The pane's `stateStartedAt` moves on every state change,
// `waiting` included, so a question the lead asked (967668df, 23:23:06)
// started a "new run" while four agents and a shell ran on. The phone keeps
// its own record: the start of the working run that followed the last `done`
// it saw.

export type SessionTaskEvidence = {
  ownAgentIds: readonly string[]
  /** Rows given the benefit of the doubt, until they stop. Null until the
   *  phone first reads this session's roster. */
  preexistingAgentIds: readonly string[] | null
  /** Every roster id already placed; one is never placed twice. */
  placedAgentIds: readonly string[]
  /** Pending Agent calls that already vouched for a row. */
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
  placedAgentIds: [],
  vouchedCallKeys: [],
  retiredTaskIds: [],
  lastStatus: null,
  lastShellCount: null,
  leadOnlyShellCount: null,
  lastPane: null,
  runBoundaryAt: undefined
}

/** How far before a call the host may stamp the row it started. */
const CALL_TO_ROW_SKEW_MS = 2_000

/** Folds what the phone sees now into what it has seen. The id lists come
 *  back as the SAME arrays when nothing new arrived, so readers keyed on them
 *  do not recount. */
export function rememberTaskEvidence(
  previous: SessionTaskEvidence,
  seen: {
    window: WindowTaskEvidence
    agentStatus: AgentStatusEntry | null
    onScreenShellCount: number | null
    now: number
  }
): SessionTaskEvidence {
  const { window, agentStatus, onScreenShellCount, now } = seen
  const working = agentStatus ? (agentStatus.subagents ?? []).filter((row) => row.state !== 'idle') : null
  const placed = working ? placeRows(previous, window, working) : null
  const pane = nextPane(previous, agentStatus)
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
    ...pane
  }
}

function placeRows(
  previous: SessionTaskEvidence,
  window: WindowTaskEvidence,
  working: readonly RosterRow[]
): { own: string[]; preexisting: readonly string[]; placed: string[]; vouched: string[] } {
  if (previous.preexistingAgentIds === null) {
    const ids = working.map((row) => row.id)
    return { own: [], preexisting: ids, placed: ids, vouched: [] }
  }
  const still = new Set(working.map((row) => row.id))
  const kept = previous.preexistingAgentIds.filter((id) => still.has(id))
  const preexisting: string[] = [...kept]
  const own: string[] = []
  const placed: string[] = []
  const vouched: string[] = []
  if (window.oldestAt === null) {
    // No window loaded (a re-subscribe starts from an empty list): nothing
    // new is placed until one is.
    return { own, preexisting: sameOrNew(previous.preexistingAgentIds, preexisting), placed, vouched }
  }
  const known = new Set([...previous.placedAgentIds, ...previous.ownAgentIds, ...window.ownAgentIds])
  const usedCalls = new Set(previous.vouchedCallKeys)
  const fresh = working.filter((row) => !known.has(row.id))
  for (const row of [...fresh].sort((left, right) => left.startedAt - right.startedAt)) {
    placed.push(row.id)
    const call = window.pendingAgentCalls.find(
      (candidate) =>
        !usedCalls.has(candidate.key) &&
        candidate.at !== null &&
        candidate.at - CALL_TO_ROW_SKEW_MS <= row.startedAt &&
        (candidate.subagentType === null || !row.agentType || candidate.subagentType === row.agentType)
    )
    if (call) {
      usedCalls.add(call.key)
      vouched.push(call.key)
      own.push(row.id)
    } else if (row.startedAt < window.oldestAt) {
      preexisting.push(row.id)
    }
  }
  return { own, preexisting: sameOrNew(previous.preexistingAgentIds, preexisting), placed, vouched }
}

function sameOrNew(previous: readonly string[], next: readonly string[]): readonly string[] {
  return previous.length === next.length && previous.every((id, index) => id === next[index]) ? previous : next
}

/** The start of the working run that followed the last `done` the phone saw.
 *  The first working state it sees stands in, as the pane's own start always
 *  did; a working state after a `waiting` keeps the boundary it had. */
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
  const followsDone = before === null || before.state === 'done'
  return { lastPane, runBoundaryAt: followsDone ? agentStatus.stateStartedAt : (previous.runBoundaryAt ?? null) }
}
