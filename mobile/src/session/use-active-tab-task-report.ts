import { useMemo } from 'react'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { readTaskEvidence } from './mobile-background-task-evidence'
import {
  EMPTY_SESSION_TASK_EVIDENCE,
  rememberTaskEvidence,
  type SessionTaskEvidence
} from './mobile-background-task-memory'
import type { AgentProvenance } from './mobile-background-task-roster'
import type { ScreenTaskCompletion } from './mobile-background-tasks'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'
import { useActiveTabScreenCompletions } from './use-active-tab-screen-completions'

/** How long the session's last host status stands in for a missing one: long
 *  enough to bridge a snapshot that came without it, short enough that a
 *  session which really went away stops showing its agents within a minute. */
export const HELD_AGENT_STATUS_MAX_AGE_MS = 60_000

/** Per session, for as long as the app runs, so a tab switch or a remount
 *  does not forget which agents were the lead's. Keyed by the agent's own
 *  session id, never the terminal handle, which outlives the process in it. */
const memories = new Map<string, SessionTaskEvidence>()
const MEMORY_SESSIONS_MAX = 16

function remember(sessionId: string, evidence: SessionTaskEvidence): void {
  memories.delete(sessionId)
  memories.set(sessionId, evidence)
  if (memories.size > MEMORY_SESSIONS_MAX) {
    const oldest = memories.keys().next().value
    if (oldest !== undefined) {
      memories.delete(oldest)
    }
  }
}

export function resetTaskEvidenceForTests(): void {
  memories.clear()
}

/** Folds this render's sighting into the session's memory. The clock is read
 *  here, not in the hook: the sighting is stamped when it was made. */
function observeSession(
  sessionId: string | null,
  seen: Omit<Parameters<typeof rememberTaskEvidence>[1], 'now'>
): { evidence: SessionTaskEvidence | null; now: number } {
  const now = Date.now()
  if (sessionId === null) {
    return { evidence: null, now }
  }
  const evidence = rememberTaskEvidence(memories.get(sessionId) ?? EMPTY_SESSION_TASK_EVIDENCE, { ...seen, now })
  remember(sessionId, evidence)
  return { evidence, now }
}

/** The beacon's report for the active tab, with everything the phone has seen
 *  of this session's background work folded in (`mobile-background-task-
 *  evidence.ts`): the screen's completions and footer count, which agents are
 *  the lead's own, the ids a window showed ending, and the last host status.
 *  The status line's count and the tasks sheet both read this one object. */
export function useActiveTabTaskReport(input: {
  report: ActiveTabBackgroundTaskReport
  handle: string | null
  sessionId: string | null
  agent: string | null
  /** The UNFILTERED transcript window the chat holds. */
  messages: readonly NativeChatMessage[]
  agentStatus: AgentStatusEntry | null
  onScreenShellCount: number | null
  screenTaskCompletions: readonly ScreenTaskCompletion[]
}): ActiveTabBackgroundTaskReport {
  const { report, sessionId, agentStatus, onScreenShellCount } = input
  const screenCompletions = useActiveTabScreenCompletions(input.handle, sessionId, input.screenTaskCompletions)
  const window = useMemo(() => readTaskEvidence(input.messages), [input.messages])
  const { evidence, now } = observeSession(sessionId, { window, agentStatus, onScreenShellCount })
  // Claude's transcript records every launch the lead makes (OpenClaude
  // writes the same one); a Codex one records none the phone reads, so its
  // roster is taken as it stands.
  const placeable = (input.agent === 'claude' || input.agent === 'openclaude') && evidence !== null
  const own = evidence?.ownAgentIds
  const preexisting = evidence?.preexistingAgentIds
  const agentProvenance = useMemo<AgentProvenance | null>(
    () => (placeable && own ? { ownAgentIds: own, preexistingAgentIds: preexisting ?? [] } : null),
    [placeable, own, preexisting]
  )
  const retired = evidence?.retiredTaskIds
  const finishedTaskIds = useMemo(
    () => (retired && retired.length > 0 ? [...new Set([...report.finishedTaskIds, ...retired])] : report.finishedTaskIds),
    [report.finishedTaskIds, retired]
  )
  const lastStatus = evidence?.lastStatus ?? null
  const heldAgentStatus =
    agentStatus === null && lastStatus && now - lastStatus.at <= HELD_AGENT_STATUS_MAX_AGE_MS ? lastStatus.status : null
  const heldOnScreenShellCount = onScreenShellCount === null ? (evidence?.lastShellCount ?? null) : null
  const leadOnlyShellCount = evidence?.leadOnlyShellCount ?? null
  const runBoundaryAt = evidence?.runBoundaryAt
  return useMemo(
    () => ({
      ...report,
      finishedTaskIds,
      onScreenShellCount,
      heldOnScreenShellCount,
      leadOnlyShellCount,
      screenCompletions,
      agentProvenance,
      heldAgentStatus,
      ...(runBoundaryAt === undefined ? {} : { runBoundaryAt })
    }),
    [agentProvenance, finishedTaskIds, heldAgentStatus, heldOnScreenShellCount, leadOnlyShellCount, onScreenShellCount, report, runBoundaryAt, screenCompletions]
  )
}
