import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { asyncAgentLaunchResult } from './fixtures/claude-parallel-agents-2.1.281'
import { readTaskEvidence } from './mobile-background-task-evidence'

// What one loaded window proves about the lead's own agents.

const at = (iso: string) => Date.parse(iso)

describe('the agents a window proves the lead launched', () => {
  it('places an agent whose launch result paired with another call of the same turn', () => {
    // Results land in the order launches were acknowledged, not the order of
    // the calls (mobile-background-task-agent-titles.ts). An Agent call and a
    // Bash call in one turn whose results came back swapped pair each result
    // with the wrong call, and neither reads as a launch by pairing alone.
    const turn: NativeChatMessage[] = [
      {
        id: 'calls',
        role: 'assistant',
        timestamp: at('2026-09-26T01:00:00.000Z'),
        source: 'transcript',
        blocks: [
          { type: 'tool-call', name: 'Agent', input: { description: '[review]', prompt: '[prompt]', run_in_background: true } },
          { type: 'tool-call', name: 'Bash', input: { command: '[command]', description: '[build]', run_in_background: true } }
        ]
      },
      {
        id: 'results',
        role: 'tool',
        timestamp: at('2026-09-26T01:00:02.000Z'),
        source: 'transcript',
        blocks: [
          { type: 'tool-result', output: 'Command running in background with ID: bq1w2e3r4. Output is being written to: /tmp/bq1w2e3r4.output.' },
          { type: 'tool-result', output: asyncAgentLaunchResult('a5c1d2e3f4a5b6c7d') }
        ]
      }
    ]

    expect(readTaskEvidence(turn).ownAgentIds).toContain('a5c1d2e3f4a5b6c7d')
  })

  it('does not take an agent id from a command whose output only quotes one', () => {
    const turn: NativeChatMessage[] = [
      { id: 'c', role: 'assistant', timestamp: at('2026-09-26T01:00:00.000Z'), source: 'transcript', blocks: [{ type: 'tool-call', name: 'Bash', input: { command: 'grep agentId: notes.txt' } }] },
      { id: 'r', role: 'tool', timestamp: at('2026-09-26T01:00:01.000Z'), source: 'transcript', blocks: [{ type: 'tool-result', output: 'notes.txt: agentId: a0000000000000001 (seen yesterday)' }] }
    ]

    expect(readTaskEvidence(turn).ownAgentIds).toEqual([])
  })

  it('reads nothing from an empty window, and no oldest time', () => {
    expect(readTaskEvidence([])).toEqual({ ownAgentIds: [], shellLaunches: [], retiredTaskIds: [], pendingAgentCalls: [], oldestAt: null })
  })
})
