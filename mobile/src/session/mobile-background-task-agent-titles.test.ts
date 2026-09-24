import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { deriveBackgroundTasks, type BackgroundTaskHostStatus } from './mobile-background-tasks'
import { confirmedAgentDescriptions } from './mobile-background-task-agent-titles'
import {
  PARALLEL_AGENTS,
  agentFinishedNotification,
  parallelAgentMessages
} from './fixtures/claude-parallel-agents-2.1.281'

const NOW = Date.parse('2026-09-23T23:36:34.000Z')

/** What Orca's roster says while all five run: each id with its own
 *  description, from Claude's own background_tasks inventory. */
function rosterOfAll(): BackgroundTaskHostStatus {
  return {
    state: 'working',
    subagents: PARALLEL_AGENTS.map((agent) => ({
      id: agent.agentId,
      description: agent.description,
      state: 'working' as const,
      startedAt: Date.parse(agent.at)
    }))
  }
}

function titlesById(tasks: { id: string; title: string }[]): Record<string, string> {
  return Object.fromEntries(tasks.map((task) => [task.id, task.title]))
}

const RIGHT_TITLES = Object.fromEntries(
  PARALLEL_AGENTS.map((agent) => [agent.agentId, agent.description])
)

function notified(agentId: string, description: string, at: number): NativeChatMessage {
  return {
    id: `notification-${agentId}`,
    role: 'user',
    timestamp: at,
    source: 'transcript',
    blocks: [{ type: 'text', text: agentFinishedNotification(agentId, description) }]
  }
}

describe('five agents whose launch results landed out of order', () => {
  it('names each running agent after its own description, not its neighbour\'s', () => {
    const { running } = deriveBackgroundTasks(parallelAgentMessages(), NOW, rosterOfAll())
    expect(titlesById(running)).toEqual(RIGHT_TITLES)
  })

  it('times each agent from its own launch', () => {
    const { running } = deriveBackgroundTasks(parallelAgentMessages(), NOW, rosterOfAll())
    const startedAt = Object.fromEntries(running.map((task) => [task.id, task.startedAt]))
    expect(startedAt).toEqual(
      Object.fromEntries(PARALLEL_AGENTS.map((agent) => [agent.agentId, Date.parse(agent.at)]))
    )
  })

  it('learns which is which from the finished notifications when the host has no roster', () => {
    const finishedAt = NOW - 1000
    const messages = [
      ...parallelAgentMessages(),
      ...PARALLEL_AGENTS.map((agent) => notified(agent.agentId, agent.description, finishedAt))
    ]
    const { finished } = deriveBackgroundTasks(messages, NOW, null)
    expect(titlesById(finished)).toEqual(RIGHT_TITLES)
  })

  it('leaves a launch as it was when a notification quotes a description no call made', () => {
    const [first] = PARALLEL_AGENTS
    const messages = [
      ...parallelAgentMessages(),
      notified(first.agentId, 'An agent this window never launched', NOW - 1000)
    ]
    const before = deriveBackgroundTasks(parallelAgentMessages(), NOW, null)
    const after = deriveBackgroundTasks(messages, NOW, null)
    const title = (tasks: typeof after) =>
      [...tasks.running, ...tasks.finished].find((task) => task.id === first.agentId)?.title
    expect(title(after)).toBe(title(before))
  })
})

// A foreground agent's result, from a NexOS session on this machine
// (2026-08-11 07:56 UTC): the report — cut here after its first sentence —
// then the id and usage block Claude Code appends once the run is over.
const FOREGROUND_RESULT = `## Summary

**Verdict: NO** — no official IONITY truck-suitability flag for German sites exists.
agentId: a093e15feb44a7819 (use SendMessage with to: 'a093e15feb44a7819', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 92022
tool_uses: 28
duration_ms: 310179</usage>`

describe('an agent that ran in the foreground', () => {
  const at = Date.parse('2026-08-11T07:50:55.000Z')
  const messages: NativeChatMessage[] = [
    {
      id: 'call',
      role: 'assistant',
      timestamp: at,
      source: 'transcript',
      blocks: [
        {
          type: 'tool-call',
          name: 'Agent',
          input: { description: 'Research IONITY truck sites', subagent_type: 'general-purpose' }
        }
      ]
    },
    {
      id: 'result',
      role: 'user',
      timestamp: at + 310_179,
      source: 'transcript',
      blocks: [{ type: 'tool-result', output: FOREGROUND_RESULT }]
    }
  ]

  it('is listed as finished once its report is in, even with no host status', () => {
    const tasks = deriveBackgroundTasks(messages, at + 400_000, null)
    expect(tasks.running).toEqual([])
    expect(tasks.finished.map((task) => [task.id, task.status, task.title])).toEqual([
      ['a093e15feb44a7819', 'completed', 'Research IONITY truck sites']
    ])
  })
})

describe('the descriptions Claude Code has confirmed for an agent id', () => {
  it('reads them off the host roster and the finished notifications', () => {
    const [keep, labels] = PARALLEL_AGENTS
    const confirmed = confirmedAgentDescriptions(
      [notified(labels.agentId, labels.description, NOW)],
      [{ id: keep.agentId, description: keep.description, state: 'working', startedAt: NOW }]
    )
    expect(Object.fromEntries(confirmed)).toEqual({
      [keep.agentId]: keep.description,
      [labels.agentId]: labels.description
    })
  })

  it('decodes the escaped ampersand a notification writes for "&"', () => {
    const confirmed = confirmedAgentDescriptions(
      [notified('a1b2c3d4e5f6a7b8c', 'Build &amp; test', NOW)],
      undefined
    )
    expect(confirmed.get('a1b2c3d4e5f6a7b8c')).toBe('Build & test')
  })

  it('confirms nothing for a transcript with no agents at all', () => {
    expect(confirmedAgentDescriptions([], undefined).size).toBe(0)
  })
})
