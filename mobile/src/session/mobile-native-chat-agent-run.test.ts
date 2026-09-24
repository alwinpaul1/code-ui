import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { agentRunState, isAgentOnlyRun } from './mobile-native-chat-agent-run'
import { deriveBackgroundTasks } from './mobile-background-tasks'
import { confirmedAgentDescriptions } from './mobile-background-task-agent-titles'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { splitTurnIntoSegments } from './mobile-native-chat-turn-segments'
import {
  PARALLEL_AGENTS,
  asyncAgentLaunchResult,
  parallelAgentMessages
} from './fixtures/claude-parallel-agents-2.1.281'

const NOW = Date.parse('2026-09-23T23:36:34.000Z')

/** The run of work the chat draws under "Doing the rest…": the five calls and
 *  their five results, folded exactly as the list folds them. */
function drawnRun(messages = parallelAgentMessages()): NativeChatBlock[] {
  const folded = foldMobileNativeChatMessages(messages)
  const turn = folded.at(-1)
  const tools = splitTurnIntoSegments(turn?.blocks ?? []).filter((segment) => segment.kind === 'tools')
  expect(tools).toHaveLength(1)
  return tools[0]!.blocks
}

function roster(ids: readonly string[]) {
  return {
    state: 'working' as const,
    subagents: PARALLEL_AGENTS.filter((agent) => ids.includes(agent.agentId)).map((agent) => ({
      id: agent.agentId,
      description: agent.description,
      state: 'working' as const,
      startedAt: Date.parse(agent.at)
    }))
  }
}

/** What the chat hands the row: the same reader the sheet uses. */
function inputs(stillRunning: readonly string[], agentWorking = true) {
  const messages = parallelAgentMessages()
  const status = roster(stillRunning)
  const { running } = deriveBackgroundTasks(messages, NOW, status)
  return {
    runningIds: new Set(running.filter((task) => task.kind === 'agent').map((task) => task.id)),
    confirmed: confirmedAgentDescriptions(messages, status.subagents),
    agentWorking
  }
}

const ALL = PARALLEL_AGENTS.map((agent) => agent.agentId)

describe('the row for a run of agents', () => {
  it('is drawn for the five agents Claude launched side by side', () => {
    expect(isAgentOnlyRun(drawnRun())).toBe(true)
  })

  it('says it is running while any one of the five still runs', () => {
    expect(agentRunState(drawnRun(), inputs(ALL)).running).toBe(true)
    expect(agentRunState(drawnRun(), inputs([PARALLEL_AGENTS[2].agentId])).running).toBe(true)
  })

  it('settles once every agent has reported, even while the turn goes on', () => {
    expect(agentRunState(drawnRun(), inputs([], true)).running).toBe(false)
  })

  it('counts launches the agent is still making as running while its turn is live', () => {
    const callsOnly = parallelAgentMessages().filter((message) => message.role === 'assistant')
    const blocks = drawnRun(callsOnly)
    expect(agentRunState(blocks, { ...inputs([]), agentWorking: true }).running).toBe(true)
    expect(agentRunState(blocks, { ...inputs([]), agentWorking: false }).running).toBe(false)
  })

  it('lists each agent under its own description, with its own id where Claude Code confirmed it', () => {
    const { entries } = agentRunState(drawnRun(), inputs(ALL))
    expect(entries).toEqual(
      PARALLEL_AGENTS.map((agent) => ({ title: agent.description, agentId: agent.agentId }))
    )
  })

  it('offers no id for an agent nothing has confirmed, rather than its neighbour\'s', () => {
    const [keep] = PARALLEL_AGENTS
    const { entries } = agentRunState(drawnRun(), inputs([keep.agentId]))
    expect(entries[0]).toEqual({ title: keep.description, agentId: keep.agentId })
    expect(entries.slice(1).map((entry) => entry.agentId)).toEqual([null, null, null, null])
  })

  it('needs no confirmation for a run of one agent', () => {
    const [keep] = PARALLEL_AGENTS
    const one: NativeChatBlock[] = [
      { type: 'tool-call', name: 'Agent', input: { description: keep.description } },
      { type: 'tool-result', output: asyncAgentLaunchResult(keep.agentId) }
    ]
    const empty = { runningIds: new Set<string>(), confirmed: new Map<string, string>(), agentWorking: false }
    expect(agentRunState(one, empty).entries).toEqual([
      { title: keep.description, agentId: keep.agentId }
    ])
  })

  it('leaves a run with any other tool in it, and an empty run, to the ordinary tool row', () => {
    const mixed: NativeChatBlock[] = [
      { type: 'tool-call', name: 'Agent', input: { description: 'x' } },
      { type: 'tool-call', name: 'Bash', input: { command: 'ls' } }
    ]
    expect(isAgentOnlyRun(mixed)).toBe(false)
    expect(isAgentOnlyRun([])).toBe(false)
    expect(isAgentOnlyRun([{ type: 'tool-result', output: 'orphan' }])).toBe(false)
  })
})
