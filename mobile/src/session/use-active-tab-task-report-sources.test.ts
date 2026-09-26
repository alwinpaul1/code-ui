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
import { deriveReportedBackgroundTasks } from './mobile-reported-background-tasks'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'
import { resetTaskEvidenceForTests, useActiveTabTaskReport } from './use-active-tab-task-report'

// The second review of the running-task fix (2026-09-26) drove the hook the
// controller uses through moments the first draft got wrong. Each case here
// was reproduced against that draft before it was fixed.

const SESSION = '967668df-a7d9-40e7-964b-7812815c010d'
const NO_BEACON: ActiveTabBackgroundTaskReport = { finishedTaskIds: [], runningTaskIds: null, runningTaskIdsAt: null, launchedTaskIds: [] }

type Frame = {
  now?: number
  messages: readonly NativeChatMessage[]
  agentStatus: AgentStatusEntry | null
  onScreenShellCount?: number | null
}

let latest: string[] = []
function Probe({ frame }: { frame: Frame }) {
  const report = useActiveTabTaskReport({
    report: NO_BEACON,
    handle: 'pty-1',
    sessionId: SESSION,
    agent: 'claude',
    messages: frame.messages,
    agentStatus: frame.agentStatus,
    onScreenShellCount: frame.onScreenShellCount ?? null,
    screenTaskCompletions: []
  })
  latest = deriveReportedBackgroundTasks(frame.messages, frame.now ?? 0, frame.agentStatus, report).running.map((task) => task.id)
  return null
}

function pane(state: AgentStatusState, stateStartedAt: string, subagents: AgentSubagentSnapshot[] = []): AgentStatusEntry {
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

describe('the running-task count across the moments a source changes', () => {
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

  it('does not bring back a shell that ended before the turn did when the next prompt starts', () => {
    // Hand-started tab, no beacon. The footer read 1 shell; the shell ended
    // mid-turn (an attachment Orca's reader drops) and the pill went away;
    // the turn ended, and the next prompt started a new working run.
    const turn = backgroundShellLaunch('bs1aaaaaa', '2026-09-26T10:00:00.000Z', '2026-09-26T10:00:01.000Z')
    expect(show('2026-09-26T10:00:30.000Z', { messages: turn, agentStatus: pane('working', '2026-09-26T09:59:50.000Z'), onScreenShellCount: 1 })).toEqual(['bs1aaaaaa'])
    show('2026-09-26T10:01:00.000Z', { messages: turn, agentStatus: pane('working', '2026-09-26T09:59:50.000Z') })
    expect(show('2026-09-26T10:05:00.000Z', { messages: turn, agentStatus: pane('done', '2026-09-26T10:05:00.000Z') })).toEqual([])

    const nextPrompt = show('2026-09-26T10:30:05.000Z', { messages: turn, agentStatus: pane('working', '2026-09-26T10:30:00.000Z') })
    expect(nextPrompt).toEqual([])
  })

  it('keeps a shell launched before an answered question running while reviewers come and go', () => {
    // bhll6so5h, launched 23:14:48, ran on past the lead's question at
    // 23:23:06 and its answer at 23:24:06. No beacon on this tab.
    const turn = [
      ...ownAgentLaunch(OWN_AGENTS.a776),
      ...backgroundShellLaunch('bhll6so5h', '2026-09-25T23:14:47.900Z', '2026-09-25T23:14:48.431Z')
    ]
    const a776 = rosterRow(OWN_AGENTS.a776.id, Date.parse(OWN_AGENTS.a776.result))
    const reviewer = rosterRow(NESTED_REVIEWERS.a3a4.id, Date.parse('2026-09-25T23:24:20.000Z'))
    show('2026-09-25T23:15:00.000Z', { messages: turn, agentStatus: pane('working', '2026-09-25T21:00:00.000Z', [a776]), onScreenShellCount: 1 })
    show('2026-09-25T23:23:10.000Z', { messages: turn, agentStatus: pane('waiting', '2026-09-25T23:23:06.940Z', [a776]) })
    const counts = [
      show('2026-09-25T23:24:10.000Z', { messages: turn, agentStatus: pane('working', '2026-09-25T23:24:06.944Z', [a776]), onScreenShellCount: 1 }),
      show('2026-09-25T23:24:30.000Z', { messages: turn, agentStatus: pane('working', '2026-09-25T23:24:06.944Z', [a776, reviewer]), onScreenShellCount: 2 }),
      show('2026-09-25T23:24:50.000Z', { messages: turn, agentStatus: pane('working', '2026-09-25T23:24:06.944Z', [a776]), onScreenShellCount: 1 })
    ]
    expect(counts).toEqual([
      [OWN_AGENTS.a776.id, 'bhll6so5h'],
      [OWN_AGENTS.a776.id, 'bhll6so5h'],
      [OWN_AGENTS.a776.id, 'bhll6so5h']
    ])
  })

  it('counts an agent the lead launched while the phone was elsewhere, once it is back', () => {
    show('2026-09-25T23:50:00.000Z', {
      messages: [leadTurn('2026-09-25T23:49:00.000Z')],
      agentStatus: pane('working', '2026-09-25T21:00:00.000Z', [rosterRow(OWN_AGENTS.a441.id, Date.parse(OWN_AGENTS.a441.result))])
    })
    // abe6 launched at 23:55 while the phone read another tab; the chat came
    // back with a fresh 40-message window that starts after the launch.
    const back = show('2026-09-26T00:10:00.000Z', {
      messages: [leadTurn('2026-09-26T00:02:00.000Z'), leadTurn('2026-09-26T00:09:00.000Z')],
      agentStatus: pane('working', '2026-09-25T21:00:00.000Z', [
        rosterRow(OWN_AGENTS.a441.id, Date.parse(OWN_AGENTS.a441.result)),
        rosterRow(OWN_AGENTS.abe6.id, Date.parse(OWN_AGENTS.abe6.result))
      ])
    })
    expect(back.sort()).toEqual([OWN_AGENTS.a441.id, OWN_AGENTS.abe6.id].sort())
  })

  it('keeps a reviewer out once the window has shown the lead never launched it, after the window slides past', () => {
    const lead = rosterRow(OWN_AGENTS.a441.id, Date.parse(OWN_AGENTS.a441.result))
    const reviewer = rosterRow(NESTED_REVIEWERS.a3a4.id, Date.parse(NESTED_REVIEWERS.a3a4.first))
    show('2026-09-25T23:50:00.000Z', { messages: [leadTurn('2026-09-25T23:40:00.000Z')], agentStatus: pane('working', '2026-09-25T21:00:00.000Z', [lead]) })
    const covered = show('2026-09-26T00:00:00.000Z', {
      messages: [leadTurn('2026-09-25T23:40:00.000Z'), leadTurn('2026-09-25T23:59:50.000Z')],
      agentStatus: pane('working', '2026-09-25T21:00:00.000Z', [lead, reviewer])
    })
    const slidPast = show('2026-09-26T00:15:00.000Z', {
      messages: [leadTurn('2026-09-26T00:10:00.000Z')],
      agentStatus: pane('working', '2026-09-25T21:00:00.000Z', [lead, reviewer])
    })
    expect(covered).toEqual([OWN_AGENTS.a441.id])
    expect(slidPast).toEqual([OWN_AGENTS.a441.id])
  })

  it("counts the lead's foreground agents while they run, before any result names them", () => {
    // A foreground Agent call has no `agentId` anywhere until its run ends.
    const calls: NativeChatMessage[] = [
      {
        id: 'fg-calls',
        role: 'assistant',
        timestamp: Date.parse('2026-09-26T01:00:00.000Z'),
        source: 'transcript',
        blocks: [
          { type: 'tool-call', name: 'Agent', input: { description: '[first]', prompt: '[prompt]', subagent_type: 'Explore' } },
          { type: 'tool-call', name: 'Agent', input: { description: '[second]', prompt: '[prompt]', subagent_type: 'Explore' } }
        ]
      }
    ]
    show('2026-09-26T00:59:00.000Z', { messages: [leadTurn('2026-09-26T00:58:00.000Z')], agentStatus: pane('working', '2026-09-26T00:58:00.000Z') })
    const running = show('2026-09-26T01:00:10.000Z', {
      messages: [leadTurn('2026-09-26T00:58:00.000Z'), ...calls],
      agentStatus: pane('working', '2026-09-26T00:58:00.000Z', [
        { ...rosterRow('a093e15feb44a7819', Date.parse('2026-09-26T01:00:01.000Z')), agentType: 'Explore' },
        { ...rosterRow('a1b2c3d4e5f607182', Date.parse('2026-09-26T01:00:01.500Z')), agentType: 'Explore' }
      ])
    })
    expect(running.sort()).toEqual(['a093e15feb44a7819', 'a1b2c3d4e5f607182'])
  })

  it("does not let a foreground call vouch for the reviewer its agent starts", () => {
    const call: NativeChatMessage = {
      id: 'fg-call',
      role: 'assistant',
      timestamp: Date.parse('2026-09-26T01:00:00.000Z'),
      source: 'transcript',
      blocks: [{ type: 'tool-call', name: 'Agent', input: { description: '[one]', prompt: '[prompt]', subagent_type: 'general-purpose' } }]
    }
    const agent = rosterRow('a093e15feb44a7819', Date.parse('2026-09-26T01:00:01.000Z'))
    show('2026-09-26T00:59:00.000Z', { messages: [leadTurn('2026-09-26T00:58:00.000Z')], agentStatus: pane('working', '2026-09-26T00:58:00.000Z') })
    show('2026-09-26T01:00:05.000Z', { messages: [leadTurn('2026-09-26T00:58:00.000Z'), call], agentStatus: pane('working', '2026-09-26T00:58:00.000Z', [agent]) })
    const reviewerStarts = show('2026-09-26T01:03:00.000Z', {
      messages: [leadTurn('2026-09-26T00:58:00.000Z'), call],
      agentStatus: pane('working', '2026-09-26T00:58:00.000Z', [agent, rosterRow('a5c1d2e3f4a5b6c7d', Date.parse('2026-09-26T01:02:30.000Z'))])
    })
    expect(reviewerStarts).toEqual(['a093e15feb44a7819'])
  })
})
