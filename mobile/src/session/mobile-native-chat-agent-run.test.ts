import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { agentRunState, isAgentOnlyRun, runningAgentText } from './mobile-native-chat-agent-run'
import { deriveBackgroundTasks } from './mobile-background-tasks'
import { confirmedAgentDescriptions } from './mobile-background-task-agent-titles'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { splitTurnIntoSegments } from './mobile-native-chat-turn-segments'
import {
  MIXED_RUN_AGENT_ID,
  MIXED_RUN_AGENT_DESCRIPTION,
  mixedRunWithBackgroundAgent
} from './fixtures/claude-mixed-tool-run-agent-2026-10-01'
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

describe('the agents of a mixed run', () => {
  const idle = { runningIds: new Set<string>(), confirmed: new Map<string, string>(), agentWorking: false }

  it('lists only the Agent call as an agent, not the commands beside it', () => {
    expect(agentRunState(mixedRunWithBackgroundAgent(), idle).entries).toHaveLength(1)
  })

  it('lists one agent for CronDelete, three commands and an Agent, and runs it by its launch id', () => {
    const state = agentRunState(mixedRunWithBackgroundAgent(), {
      ...idle,
      runningIds: new Set([MIXED_RUN_AGENT_ID])
    })
    expect(state.entries.map((entry) => entry.title)).toEqual([MIXED_RUN_AGENT_DESCRIPTION])
    expect(state.running).toBe(true)
    expect(agentRunState(mixedRunWithBackgroundAgent(), idle).running).toBe(false)
  })

  it('does not count the commands\' answers as the agent launch\'s answer', () => {
    // The agent call is unanswered (its result is cut) while the turn works:
    // its launch is being made. Counted over every result, the commands'
    // four answers would hide that.
    const blocks = mixedRunWithBackgroundAgent().slice(0, -1)
    expect(agentRunState(blocks, { ...idle, agentWorking: true }).running).toBe(true)
  })

  it('lists no agent for an empty run, a run of commands, or a lone result', () => {
    expect(agentRunState([], idle).entries).toEqual([])
    expect(agentRunState([{ type: 'tool-call', name: 'Bash', input: { command: 'ls' } }], idle).entries).toEqual([])
    expect(agentRunState([{ type: 'tool-result', output: 'x' }], idle).running).toBe(false)
  })
})

describe('a mixed run whose results land out of call order', () => {
  const [agentCall, launch] = mixedRunWithBackgroundAgent().slice(-2)
  const outOfOrder: NativeChatBlock[] = [
    { type: 'tool-call', name: 'Read', input: { file_path: 'notes.md' } },
    agentCall!,
    launch!,
    { type: 'tool-result', output: '# Notes' }
  ]
  const idle = { runningIds: new Set([MIXED_RUN_AGENT_ID]), confirmed: new Map<string, string>(), agentWorking: false }

  it('lists the one agent with the id its launch result carries', () => {
    const state = agentRunState(outOfOrder, idle)
    expect(state.entries).toEqual([{ title: MIXED_RUN_AGENT_DESCRIPTION, agentId: MIXED_RUN_AGENT_ID }])
    expect(state.running).toBe(true)
  })

  it('never lends a run an agent id from another run\'s results', () => {
    const state = agentRunState([agentCall!], idle)
    expect(state.entries[0]!.agentId).toBeNull()
    expect(state.running).toBe(false)
  })
})

// Review of feat/tool-run-sheet: `unanswered` counted every call of the run, so
// a finished agent's run with an unrelated unanswered call read as launching.
describe('an unanswered call that is not an agent', () => {
  const [agentCall, launch] = mixedRunWithBackgroundAgent().slice(-2)
  const idle = { runningIds: new Set<string>(), confirmed: new Map<string, string>(), agentWorking: true }

  it('does not make a finished agent read as running on a working tab', () => {
    const blocks: NativeChatBlock[] = [agentCall!, launch!, { type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' } }]
    expect(agentRunState(blocks, idle).running).toBe(false)
  })

  it('still reads an agent call with no answer as running while the tab works', () => {
    expect(agentRunState([agentCall!], idle).running).toBe(true)
  })

  it('counts a launch that landed in another call\'s slot as the agent\'s answer', () => {
    const blocks: NativeChatBlock[] = [{ type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' } }, agentCall!, launch!]
    expect(agentRunState(blocks, idle).running).toBe(false)
  })
})

// 2026-10-09: the Claude app's collapsed row names the agent, "Running agent:
// Review: story flow". Three reviewers ran side by side and it named the first.
describe('the agent the collapsed row names', () => {
  const idle = { runningIds: new Set<string>(), confirmed: new Map<string, string>(), agentWorking: false }
  const call = (input: unknown, state: 'running' | 'completed'): NativeChatBlock => ({
    type: 'tool-call',
    name: 'Agent',
    input,
    state
  })

  it('is the first agent that still runs, by its launch id', () => {
    const { subject } = agentRunState(drawnRun(), inputs([PARALLEL_AGENTS[3].agentId, PARALLEL_AGENTS[4].agentId]))
    expect(subject).toBe(PARALLEL_AGENTS[3].description)
  })

  it('is the first agent whose call is still live, when no launch id says so', () => {
    const blocks = [call({ description: 'one' }, 'completed'), call({ description: 'two' }, 'running'), call({ description: 'three' }, 'running')]
    expect(agentRunState(blocks, idle).subject).toBe('two')
  })

  it('falls back to the last agent launched when none is known to run on its own', () => {
    const blocks = [call({ description: 'one' }, 'completed'), call({ description: 'two' }, 'completed')]
    expect(agentRunState(blocks, { ...idle, agentWorking: true }).subject).toBe('two')
  })

  it('is the one agent of a run of one', () => {
    expect(agentRunState([call({ description: 'only' }, 'running')], idle).subject).toBe('only')
  })

  it('is null for a run with no agent, and for an agent that names nothing', () => {
    expect(agentRunState([], idle).subject).toBeNull()
    expect(agentRunState([call({ prompt: 'p' }, 'running')], idle).subject).toBeNull()
  })

  it('reads as the bare label with no subject, and with one as "Running agent: <subject>"', () => {
    expect(runningAgentText(null)).toBe('Running agent')
    expect(runningAgentText('Review: story flow')).toBe('Running agent: Review: story flow')
  })
})
