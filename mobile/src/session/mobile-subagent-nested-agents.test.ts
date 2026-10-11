import { describe, expect, it } from 'vitest'
import type { AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import type { BackgroundTask, BackgroundTasks } from './mobile-background-tasks'
import { mergeSubagentActivity } from './mobile-subagent-activity'
import {
  NESTED_AFTER_LAUNCH_UUID,
  NESTED_AGENT,
  NESTED_AGENT_TITLE,
  NESTED_LAUNCHED_AT,
  NESTED_PARENT_AGENT,
  NESTED_PARENT_TITLE,
  nestedParentRows
} from './fixtures/claude-nested-agent-2.1.296'

// The user's real session 0954729d (fixtures/claude-nested-agent-2.1.296.ts):
// the Claude app listed "Opus regression review of outbox drainer", started by
// the lead's agent "Reliable sends, never dropped", as a Running row of its
// own, "Agent  30s". Code UI did not list it at all. The open sheet already
// reads the parent's transcript (`MobileSubagentActivityFeeds.tsx`), and that
// shows the launch; Orca's roster lists the reviewer while it runs.

const NOW = NESTED_LAUNCHED_AT + 30_000
const PARENT_STARTED = NESTED_LAUNCHED_AT - 44 * 60_000

const parentRow = (): BackgroundTask => ({
  id: NESTED_PARENT_AGENT,
  kind: 'agent',
  title: NESTED_PARENT_TITLE,
  status: 'running',
  startedAt: PARENT_STARTED,
  elapsedMs: NOW - PARENT_STARTED
})
const lead = (): BackgroundTasks => ({ running: [parentRow()], finished: [] })
const row = (id: string, startedAt: number): AgentSubagentSnapshot => ({ id, agentType: 'general-purpose', state: 'working', startedAt })
const BOTH_RUNNING = [row(NESTED_PARENT_AGENT, PARENT_STARTED), row(NESTED_AGENT, NESTED_LAUNCHED_AT + 400)]
const feed = (uuid?: string) => new Map([[NESTED_PARENT_AGENT, nestedParentRows(uuid)]])

describe("a subagent's own subagent is a row of its own, as the Claude app lists it", () => {
  it('lists "Opus regression review of outbox drainer" running, timed from its launch, while the roster lists it', () => {
    const merged = mergeSubagentActivity(lead(), feed(NESTED_AFTER_LAUNCH_UUID), { now: NOW, hostSubagents: BOTH_RUNNING })

    expect(merged.running.map((task) => [task.id, task.kind, task.title])).toEqual([
      [NESTED_PARENT_AGENT, 'agent', NESTED_PARENT_TITLE],
      [NESTED_AGENT, 'agent', NESTED_AGENT_TITLE]
    ])
    expect(merged.running[1]).toMatchObject({ status: 'running', elapsedMs: 30_000 })
  })

  it('moves it to Finished once the roster drops its row, though the parent never reads its end', () => {
    const merged = mergeSubagentActivity(lead(), feed(), { now: NOW + 7 * 60_000, hostSubagents: [row(NESTED_PARENT_AGENT, PARENT_STARTED)] })

    expect(merged.running.map((task) => task.id)).toEqual([NESTED_PARENT_AGENT])
    expect(merged.finished.map((task) => [task.id, task.kind, task.status])).toEqual([[NESTED_AGENT, 'agent', 'completed']])
  })

  it('lists no nested agent while the host gives no roster: nothing could ever end its row', () => {
    const merged = mergeSubagentActivity(lead(), feed(), { now: NOW, hostSubagents: null })

    expect([...merged.running, ...merged.finished].some((task) => task.id === NESTED_AGENT)).toBe(false)
  })

  it('never lists it twice when the lead already lists that id', () => {
    const tasks = lead()
    tasks.running.push({ id: NESTED_AGENT, kind: 'agent', title: NESTED_AGENT_TITLE, status: 'running', startedAt: null, elapsedMs: null })
    const merged = mergeSubagentActivity(tasks, feed(NESTED_AFTER_LAUNCH_UUID), { now: NOW, hostSubagents: BOTH_RUNNING })

    expect(merged.running.filter((task) => task.id === NESTED_AGENT)).toHaveLength(1)
  })

  it('changes nothing with no subagent feeds, and carries no subagent shell count', () => {
    const tasks = lead()
    expect(mergeSubagentActivity(tasks, new Map(), { now: NOW, hostSubagents: BOTH_RUNNING })).toBe(tasks)
    const merged = mergeSubagentActivity(tasks, feed(NESTED_AFTER_LAUNCH_UUID), { now: NOW, hostSubagents: BOTH_RUNNING, liveShellCount: 4 })
    expect(merged).not.toHaveProperty('shellsInSubagents')
  })
})
