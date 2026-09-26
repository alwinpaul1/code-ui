import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'

// ─── The host's roster of subagents, and which of them are the session's own ─
//
// Claude Code keeps one task registry for the whole process: every subagent's
// context is handed the lead's `taskRegistry` and `queuedNotificationsRegistry`
// (read from the 2.1.281, 2.1.282 and 2.1.283 bundles). So a reviewer that one
// of the lead's agents starts fires SubagentStart on the LEAD's pane, and
// Orca's roster (`agentStatus.subagents`) lists it beside the lead's own
// agents. The rows carry nothing that tells them apart: at the lead's Stop the
// same `background_tasks` payload names both (seen live 2026-09-26 00:53:36,
// two spawnDepth-2 rows gaining descriptions at once).
//
// Claude Code's own agent panel lists only the lead's agents at the top level
// and folds a reviewer under its parent as "(+N)" (the panel's row filter keeps
// a row whose nearest live parent agent is the one being viewed; none, at the
// top). The phone counts the same set. What places a row is the LEAD's
// transcript, which holds the launch of every agent the lead started and never
// a reviewer's; see `AgentProvenance`.

export type RosterRow = NonNullable<AgentStatusEntry['subagents']>[number]

/** What the phone has seen of this session's own agents, across every window
 *  of its transcript it has read this run (`use-active-tab-task-evidence.ts`). */
export type AgentProvenance = {
  /** Agents the lead's transcript showed launched (`agentId:` in an Agent
   *  result) or messaged (SendMessage `to`, which resumes a finished one), and
   *  foreground agents an unanswered Agent call of the lead's vouched for. */
  ownAgentIds: readonly string[]
  /** Rows the phone cannot place, still running: on the first roster it
   *  read, rebuilt by Orca, with no agent before them to have started them,
   *  first seen just after the phone lost sight, or started before the loaded
   *  window reaches back. They keep the benefit of the doubt until they stop;
   *  any other row the lead's transcript does not name is a subagent's
   *  (`mobile-background-task-memory.ts`). */
  preexistingAgentIds: readonly string[]
}

/** Subagents the host still counts as busy, by id; null when the host gave no
 *  status at all (then only the transcript can speak). */
export function liveSubagentRoster(hostStatus: Pick<AgentStatusEntry, 'subagents'> | null): Map<string, RosterRow> | null {
  if (!hostStatus) {
    return null
  }
  const roster = new Map<string, RosterRow>()
  for (const snapshot of hostStatus.subagents ?? []) {
    if (snapshot.state !== 'idle') {
      roster.set(snapshot.id, snapshot)
    }
  }
  return roster
}

/** `a<name>-<hex>`: an agent-team teammate or a named agent's lifecycle id
 *  (the shape Orca's `isClaudeTeammateLifecycleId` tests). Claude Code refuses
 *  a teammate spawned from inside a subagent (`subagent_nested_teammate`), so
 *  one of these on the roster is always the lead's. */
export function isTeammateLifecycleId(id: string): boolean {
  const separator = id.lastIndexOf('-')
  return separator > 1 && id.startsWith('a') && /^[0-9a-f]+$/i.test(id.slice(separator + 1))
}

/** Whether a roster row the loaded window never showed launched is the
 *  session's own work. With no provenance (a Codex tab, whose transcript
 *  records no launch the phone reads) every row is taken as it stands. */
export function createRosterOwnership(provenance: AgentProvenance | null): (id: string) => boolean {
  if (provenance === null) {
    return () => true
  }
  const known = new Set([...provenance.ownAgentIds, ...provenance.preexistingAgentIds])
  return (id) => known.has(id) || isTeammateLifecycleId(id)
}
