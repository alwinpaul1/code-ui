import { describe, expect, it } from 'vitest'
import type { AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import { countRunningBackgroundTasks, deriveBackgroundTasks, type BackgroundTaskHostStatus } from './mobile-background-tasks'
import { BACKGROUND_AGENT, backgroundAgentLaunchMessages } from './fixtures/claude-background-agent-launch-2.1.296'

// A background agent whose end Claude Code wrote only as a queue-operation and
// a queued_command attachment (session 0954729d, "Commands sheet like Claude",
// finished 07:15:46 while the lead was mid-turn; 42 of the session's 67
// background agents ended that way). Orca's reader drops both records, so the
// transcript never says it finished.
//
// The tab is hand-started, but it is an Orca terminal, and Orca's own Claude
// hooks run for every session on the machine: Orca's persisted status for this
// pane (agent-hooks/last-status.json, read on the desk 2026-10-11 at 10:50)
// listed exactly the two agents still running, "Background tasks sheet like
// Claude 2" and "Reliable sends, never dropped", and none of the finished ones.
// SubagentStop dropped each row as its agent ended. That roster is what the
// reader judges every launched agent by.

const AN_HOUR_LATER = Date.parse(BACKGROUND_AGENT.finishedAt) + 60 * 60_000
const working = (id: string, description: string, startedAt: string): AgentSubagentSnapshot => ({
  id,
  agentType: 'general-purpose',
  description,
  state: 'working',
  startedAt: Date.parse(startedAt)
})
/** The pane's roster as Orca held it: the two agents still running. */
const ORCA_ROSTER: BackgroundTaskHostStatus = {
  state: 'working',
  subagents: [
    working('a59431f8104bdd31a', 'Background tasks sheet like Claude 2', '2026-10-11T08:26:00.000Z'),
    working('a1fff1e8413ede9a2', 'Reliable sends, never dropped', '2026-10-11T07:04:00.000Z')
  ]
}

describe('a background agent whose end only a queue-operation records', () => {
  it("leaves Running, and the running count, once Orca's roster no longer lists it", () => {
    const messages = backgroundAgentLaunchMessages()
    const tasks = deriveBackgroundTasks(messages, AN_HOUR_LATER, ORCA_ROSTER, {
      agentProvenance: { ownAgentIds: [BACKGROUND_AGENT.agentId], preexistingAgentIds: [] }
    })

    expect(tasks.running.some((task) => task.id === BACKGROUND_AGENT.agentId)).toBe(false)
    expect(tasks.finished.find((task) => task.id === BACKGROUND_AGENT.agentId)).toMatchObject({ kind: 'agent', status: 'completed' })
    expect(
      countRunningBackgroundTasks(messages, ORCA_ROSTER, { agentProvenance: { ownAgentIds: [BACKGROUND_AGENT.agentId], preexistingAgentIds: [] } }, AN_HOUR_LATER)
    ).toBe(0)
  })

  it('stays running while the roster lists it', () => {
    const listed: BackgroundTaskHostStatus = {
      state: 'working',
      subagents: [working(BACKGROUND_AGENT.agentId, BACKGROUND_AGENT.description, BACKGROUND_AGENT.launchedAt)]
    }
    const tasks = deriveBackgroundTasks(backgroundAgentLaunchMessages(), Date.parse(BACKGROUND_AGENT.launchedAt) + 60_000, listed)
    expect(tasks.running.map((task) => task.id)).toEqual([BACKGROUND_AGENT.agentId])
  })

  it('cannot be retired with no host status at all: nothing the phone receives says it ended', () => {
    // A pane Orca has no hook row for (an older host, hooks not attached). The
    // agent's end is in records Orca's reader drops, no beacon runs on a
    // hand-started tab, and an agent's output file is its own JSONL, with no
    // end trailer. Pinned so the limit stays visible, not to bless it.
    const tasks = deriveBackgroundTasks(backgroundAgentLaunchMessages(), AN_HOUR_LATER, null)
    expect(tasks.running.map((task) => task.id)).toEqual([BACKGROUND_AGENT.agentId])
  })
})
