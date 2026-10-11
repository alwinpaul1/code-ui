import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { BackgroundTask } from './mobile-background-tasks'
import { liveSubagentRoster } from './mobile-background-task-roster'

// ─── Which running tasks a conversation row may sweep for ───────────────────
//
// The Background tasks sheet lists what the background-task reader counts as
// running. A conversation row's shimmer needs more than that: a source that
// will also say when the task stops. On a hand-started tab with no host status
// and no beacon the reader alone keeps a background agent running for good,
// because a completion that lands mid-turn is written only as a queue-operation
// Orca drops ("Running an Agent animation gets stuck", 2026-10-11: 42 of the 67
// background agents of session 0954729d). So a row sweeps only for:
//
// - any task on the host's structured roster (`agentSession.subscribe`), the
//   provider's own word, which the reader then is;
// - an agent on Orca's live subagent roster (`agentStatus.subagents`,
//   SubagentStart/SubagentStop), the authority on every agent it tracks;
// - a shell, while the pane has a host status at all: the pane leaves
//   `working` for `done` only when Claude's Stop hook lists no live background
//   task, and `done` retires every shell the reader holds.
//
// Anything else is the reader's word alone, which reaches the sheet and not
// the row.

export function rowLiveTaskIds(
  running: readonly BackgroundTask[],
  source: {
    /** The host published a structured roster, which `running` then is. */
    structuredRoster: boolean
    /** Orca's hook status for the pane, or null where it has none. */
    hostStatus: Pick<AgentStatusEntry, 'subagents'> | null
  }
): ReadonlySet<string> {
  if (source.structuredRoster) {
    return new Set(running.map((task) => task.id))
  }
  const roster = liveSubagentRoster(source.hostStatus)
  if (roster === null) {
    return new Set()
  }
  const ids = new Set<string>()
  for (const task of running) {
    if (task.kind === 'agent' ? roster.has(task.id) : task.kind === 'shell') {
      ids.add(task.id)
    }
  }
  return ids
}
