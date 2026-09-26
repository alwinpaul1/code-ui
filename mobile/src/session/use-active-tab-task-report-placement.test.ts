import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry, AgentStatusState, AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  NESTED_REVIEWERS,
  OWN_AGENTS,
  backgroundShellLaunch,
  leadTurn,
  ownAgentLaunch,
  rosterRow
} from './fixtures/claude-orchestration-2.1.281'
import { asyncAgentLaunchResult } from './fixtures/claude-parallel-agents-2.1.281'
import { deriveReportedBackgroundTasks } from './mobile-reported-background-tasks'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'
import { resetTaskEvidenceForTests, useActiveTabTaskReport } from './use-active-tab-task-report'

// The second review round (2026-09-26) drove 2c371292 through these and each
// read wrong. Placing a roster row as the lead's or a reviewer's has only weak
// evidence to go on — Orca's `startedAt` is when ORCA first saw the row — so
// the rules lean on what cannot be a reviewer (mobile-background-task-memory.ts).
// Two cases this file once pinned, a row Orca rebuilt with a description and
// rows Orca listed again late after losing its own roster, were dropped in the
// third round: the rules that counted them also counted reviewers after every
// return to the chat (use-active-tab-task-report-returns.test.ts).

const SESSION = '967668df-a7d9-40e7-964b-7812815c010d'
const NO_BEACON: ActiveTabBackgroundTaskReport = { finishedTaskIds: [], runningTaskIds: null, runningTaskIdsAt: null, launchedTaskIds: [] }

type Frame = { now?: number; messages: readonly NativeChatMessage[]; agentStatus: AgentStatusEntry | null; onScreenShellCount?: number | null; sessionId?: string }

let latest: string[] = []
function Probe({ frame }: { frame: Frame }) {
  const report = useActiveTabTaskReport({
    report: NO_BEACON,
    handle: 'pty-1',
    sessionId: frame.sessionId ?? SESSION,
    agent: 'claude',
    messages: frame.messages,
    transcriptSettled: true,
    agentStatus: frame.agentStatus,
    onScreenShellCount: frame.onScreenShellCount ?? null,
    screenTaskCompletions: []
  })
  latest = deriveReportedBackgroundTasks(frame.messages, frame.now ?? 0, frame.agentStatus, report).running.map((task) => task.id)
  return null
}

function pane(subagents: AgentSubagentSnapshot[], state: AgentStatusState = 'working', stateStartedAt = '2026-09-25T21:00:00.000Z'): AgentStatusEntry {
  return {
    state,
    prompt: '',
    updatedAt: Date.now(),
    stateStartedAt: Date.parse(stateStartedAt),
    paneKey: 'facefdf7-1930-4cee-a501-5e56fbf26317:8d01a29d-f9c9-48d8-91a2-0f96f9f7bcb9',
    stateHistory: [],
    subagents
  }
}
const agentCall = (id: string, iso: string, input: Record<string, unknown>): NativeChatMessage => ({
  id,
  role: 'assistant',
  timestamp: Date.parse(iso),
  source: 'transcript',
  blocks: [{ type: 'tool-call', name: 'Agent', input: { description: '[description]', prompt: '[prompt]', subagent_type: 'general-purpose', ...input } }]
})

describe('placing a roster row as the lead’s or a reviewer’s', () => {
  let renderer: ReactTestRenderer | null = null
  beforeEach(() => {
    resetTaskEvidenceForTests()
    vi.useFakeTimers()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  function show(at: string, shown: Frame): string[] {
    vi.setSystemTime(Date.parse(at))
    const frame = { ...shown, now: Date.now() }
    act(() => {
      if (renderer) {
        renderer.update(createElement(Probe, { frame }))
      } else {
        renderer = create(createElement(Probe, { frame }))
      }
    })
    return latest
  }

  it('does not let a foreground call left from before the first look vouch for a reviewer', () => {
    const fg = rosterRow('af0reground00000a', Date.parse('2026-09-26T08:00:01.000Z'))
    const window = [leadTurn('2026-09-26T07:59:00.000Z'), agentCall('fg-call', '2026-09-26T08:00:00.000Z', {})]
    const a441 = rosterRow(OWN_AGENTS.a441.id, Date.parse('2026-09-26T07:00:00.000Z'))
    show('2026-09-26T08:10:00.000Z', { messages: window, agentStatus: pane([a441, fg]) })
    const reviewerStarts = show('2026-09-26T08:20:05.000Z', {
      messages: window,
      agentStatus: pane([a441, fg, rosterRow(NESTED_REVIEWERS.a3a4.id, Date.parse('2026-09-26T08:20:00.000Z'))])
    })

    expect(reviewerStarts.sort()).toEqual([OWN_AGENTS.a441.id, fg.id].sort())
  })

  it('keeps a foreground agent’s call unanswered when a quick call of the same turn answers first', () => {
    const at = '2026-09-26T09:00:00.000Z'
    const turn: NativeChatMessage[] = [
      {
        id: 'calls',
        role: 'assistant',
        timestamp: Date.parse(at),
        source: 'transcript',
        blocks: [
          { type: 'tool-call', name: 'Agent', input: { description: '[audit]', prompt: '[prompt]', subagent_type: 'general-purpose' } },
          { type: 'tool-call', name: 'Read', input: { file_path: '/x/README.md' } }
        ]
      },
      { id: 'read-result', role: 'tool', timestamp: Date.parse(at) + 300, source: 'transcript', blocks: [{ type: 'tool-result', output: '1\t# README\n' }] }
    ]
    const before = [leadTurn('2026-09-26T08:59:00.000Z')]
    show('2026-09-26T08:59:30.000Z', { messages: before, agentStatus: pane([rosterRow(OWN_AGENTS.a441.id, Date.parse('2026-09-26T07:00:00.000Z'))]) })
    const running = show('2026-09-26T09:00:05.000Z', {
      messages: [...before, ...turn],
      agentStatus: pane([rosterRow(OWN_AGENTS.a441.id, Date.parse('2026-09-26T07:00:00.000Z')), rosterRow('af0reground00000b', Date.parse(at) + 1000)])
    })

    expect(running.sort()).toEqual([OWN_AGENTS.a441.id, 'af0reground00000b'].sort())
  })

  it('does not let a background Agent call vouch for a reviewer whose row came up first', () => {
    const a441 = rosterRow(OWN_AGENTS.a441.id, Date.parse('2026-09-25T23:07:19.920Z'))
    const reviewer = rosterRow(NESTED_REVIEWERS.a3a4.id, Date.parse('2026-09-25T23:55:20.400Z'))
    const abe6 = rosterRow(OWN_AGENTS.abe6.id, Date.parse('2026-09-25T23:55:20.900Z'))
    const before = [leadTurn('2026-09-25T23:50:00.000Z')]
    const call = agentCall('abe6-call', OWN_AGENTS.abe6.call, { run_in_background: true })
    const result: NativeChatMessage = {
      id: 'abe6-result',
      role: 'tool',
      timestamp: Date.parse(OWN_AGENTS.abe6.result),
      source: 'transcript',
      blocks: [{ type: 'tool-result', output: asyncAgentLaunchResult(OWN_AGENTS.abe6.id) }]
    }
    show('2026-09-25T23:54:00.000Z', { messages: before, agentStatus: pane([a441]) })
    show('2026-09-25T23:55:21.000Z', { messages: [...before, call], agentStatus: pane([a441, reviewer, abe6]) })
    const withResult = show('2026-09-25T23:55:23.000Z', { messages: [...before, call, result], agentStatus: pane([a441, reviewer, abe6]) })

    expect(withResult.sort()).toEqual([OWN_AGENTS.a441.id, OWN_AGENTS.abe6.id].sort())
  })

  it('retires a shell that ended in a turn whose `done` the phone never saw', () => {
    // No beacon. The phone was on another tab while turn 1 ended and turn 2
    // began: working at 09:59:50, working again at 10:30:00.
    const turn = backgroundShellLaunch('bs1aaaaaa', '2026-09-26T10:00:00.000Z', '2026-09-26T10:00:01.000Z')
    show('2026-09-26T10:00:30.000Z', { messages: turn, agentStatus: pane([], 'working', '2026-09-26T09:59:50.000Z') })
    const turnTwo = show('2026-09-26T10:31:00.000Z', { messages: turn, agentStatus: pane([], 'working', '2026-09-26T10:30:00.000Z') })

    expect(turnTwo).toEqual([])
  })

  it("does not pad a reviewer's shell into the count after the lead's own shell ended", () => {
    const shell = backgroundShellLaunch('bbgtz4rfz', '2026-09-25T23:31:47.167Z', '2026-09-25T23:31:49.604Z')
    const notified: NativeChatMessage = {
      id: 'shell-done',
      role: 'user',
      timestamp: Date.parse('2026-09-25T23:40:00.000Z'),
      source: 'transcript',
      blocks: [{ type: 'text', text: '<task-notification>\n<task-id>bbgtz4rfz</task-id>\n<status>completed</status>\n<summary>ok</summary>\n</task-notification>' }]
    }
    const abe6 = rosterRow(OWN_AGENTS.abe6.id, Date.parse(OWN_AGENTS.abe6.result))
    const reviewer = rosterRow(NESTED_REVIEWERS.a3a4.id, Date.parse(NESTED_REVIEWERS.a3a4.first))
    const launched = [...shell, notified, ...ownAgentLaunch(OWN_AGENTS.abe6)]
    show('2026-09-25T23:32:00.000Z', { messages: shell, agentStatus: pane([], 'working', '2026-09-25T23:30:00.000Z'), onScreenShellCount: 1 })
    show('2026-09-25T23:41:00.000Z', { messages: [...shell, notified], agentStatus: pane([], 'working', '2026-09-25T23:30:00.000Z') })
    show('2026-09-25T23:55:30.000Z', { messages: launched, agentStatus: pane([abe6], 'working', '2026-09-25T23:30:00.000Z') })
    show('2026-09-25T23:59:40.000Z', { messages: launched, agentStatus: pane([abe6, reviewer], 'working', '2026-09-25T23:30:00.000Z') })
    const withReviewer = show('2026-09-26T00:05:00.000Z', {
      messages: launched,
      agentStatus: pane([abe6, reviewer], 'working', '2026-09-25T23:30:00.000Z'),
      onScreenShellCount: 1
    })

    expect(withReviewer).toEqual([OWN_AGENTS.abe6.id])
  })
})
