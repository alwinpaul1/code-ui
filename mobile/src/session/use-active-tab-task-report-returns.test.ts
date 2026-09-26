import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry, AgentStatusState, AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { NESTED_REVIEWERS, OWN_AGENTS, leadTurn, ownAgentLaunch, rosterRow } from './fixtures/claude-orchestration-2.1.281'
import { deriveReportedBackgroundTasks } from './mobile-reported-background-tasks'
import { readTaskEvidence } from './mobile-background-task-evidence'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'
import { resetTaskEvidenceForTests, useActiveTabTaskReport } from './use-active-tab-task-report'

// The third review round (2026-09-26) drove 9569f1ff through the ordinary
// ways a user leaves and comes back: another tab, the first minute after
// opening, a snapshot without a status, a stale cached transcript. Each case
// here read wrong against it.

const SESSION = '967668df-a7d9-40e7-964b-7812815c010d'
const OTHER = 'b1d1c0de-0000-4000-8000-000000000000'
const NO_BEACON: ActiveTabBackgroundTaskReport = { finishedTaskIds: [], runningTaskIds: null, runningTaskIdsAt: null, launchedTaskIds: [] }

type Frame = {
  now?: number
  messages: readonly NativeChatMessage[]
  agentStatus: AgentStatusEntry | null
  onScreenShellCount?: number | null
  sessionId?: string
  /** False while the chat paints the transcript it cached before the fresh read settles. */
  settled?: boolean
}

let latest: string[] = []
function Probe({ frame }: { frame: Frame }) {
  const report = useActiveTabTaskReport({
    report: NO_BEACON,
    handle: 'pty-1',
    sessionId: frame.sessionId ?? SESSION,
    agent: 'claude',
    messages: frame.messages,
    transcriptSettled: frame.settled ?? true,
    agentStatus: frame.agentStatus,
    onScreenShellCount: frame.onScreenShellCount ?? null,
    screenTaskCompletions: []
  })
  latest = deriveReportedBackgroundTasks(frame.messages, frame.now ?? 0, frame.agentStatus, report).running.map((task) => task.id)
  return null
}

function pane(subagents: AgentSubagentSnapshot[], state: AgentStatusState = 'working', stateStartedAt = '2026-09-25T21:00:00.000Z', workingMode?: 'monitoring'): AgentStatusEntry {
  return {
    state,
    prompt: '',
    updatedAt: Date.now(),
    stateStartedAt: Date.parse(stateStartedAt),
    paneKey: 'facefdf7-1930-4cee-a501-5e56fbf26317:8d01a29d-f9c9-48d8-91a2-0f96f9f7bcb9',
    stateHistory: [],
    subagents,
    ...(workingMode ? { workingMode } : {})
  }
}
const lead = (count: number, from: string) =>
  Array.from({ length: count }, (_unused, index) => leadTurn(new Date(Date.parse(from) + index * 5_000).toISOString()))
const a441 = rosterRow(OWN_AGENTS.a441.id, Date.parse('2026-09-25T23:07:19.920Z'))
const a776 = rosterRow(OWN_AGENTS.a776.id, Date.parse('2026-09-25T23:07:10.355Z'))

describe('the running-task count when the user leaves the chat and comes back', () => {
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

  it('does not count a reviewer that gained its description at a lead turn end while the user was away', () => {
    // Orca's fold writes descriptions from `background_tasks`, which lists
    // every subagent in the process, reviewers included.
    show('2026-09-26T00:00:00.000Z', { messages: lead(40, '2026-09-25T23:57:00.000Z'), agentStatus: pane([a441, a776]) })
    show('2026-09-26T00:00:30.000Z', { messages: [], agentStatus: pane([]), sessionId: OTHER })
    const reviewer = { ...rosterRow(NESTED_REVIEWERS.a874.id, Date.parse('2026-09-26T00:01:00.000Z')), description: '[reviewer task]' }
    const back = show('2026-09-26T00:05:00.000Z', { messages: lead(40, '2026-09-25T23:59:00.000Z'), agentStatus: pane([a441, a776, reviewer]) })

    expect(back.sort()).toEqual([a441.id, a776.id].sort())
  })

  it('does not count a reviewer that came up with its parent while the user was away', () => {
    show('2026-09-25T23:50:00.000Z', { messages: lead(40, '2026-09-25T23:47:00.000Z'), agentStatus: pane([]) })
    show('2026-09-25T23:50:10.000Z', { messages: [], agentStatus: pane([]), sessionId: OTHER })
    const window = [...lead(10, '2026-09-25T23:54:00.000Z'), ...ownAgentLaunch(OWN_AGENTS.abe6), ...lead(20, '2026-09-25T23:58:00.000Z')]
    const abe6 = rosterRow(OWN_AGENTS.abe6.id, Date.parse(OWN_AGENTS.abe6.result))
    const reviewer = rosterRow(NESTED_REVIEWERS.a3a4.id, Date.parse(NESTED_REVIEWERS.a3a4.first))
    const back = show('2026-09-26T00:02:00.000Z', { messages: window, agentStatus: pane([abe6, reviewer]) })

    expect(back).toEqual([abe6.id])
  })

  it('does not count a reviewer that starts half a minute after a snapshot came without its status', () => {
    const window = lead(40, '2026-09-26T00:07:00.000Z')
    show('2026-09-26T00:10:00.000Z', { messages: window, agentStatus: pane([a441]) })
    show('2026-09-26T00:15:00.000Z', { messages: window, agentStatus: pane([a441]) })
    show('2026-09-26T00:15:01.000Z', { messages: window, agentStatus: null })
    show('2026-09-26T00:15:02.000Z', { messages: window, agentStatus: pane([a441]) })
    const later = show('2026-09-26T00:15:32.000Z', {
      messages: window,
      agentStatus: pane([a441, rosterRow(NESTED_REVIEWERS.aba3.id, Date.parse('2026-09-26T00:15:31.500Z'))])
    })

    expect(later).toEqual([a441.id])
  })

  it('does not count a reviewer that starts in the first minute after the chat opens', () => {
    const window = lead(40, '2026-09-26T00:17:00.000Z')
    show('2026-09-26T00:20:00.000Z', { messages: window, agentStatus: pane([a441]) })
    const early = show('2026-09-26T00:20:40.000Z', {
      messages: window,
      agentStatus: pane([a441, rosterRow(NESTED_REVIEWERS.aba3.id, Date.parse('2026-09-26T00:20:39.500Z'))])
    })

    expect(early).toEqual([a441.id])
  })

  it("counts an agent the lead launched while the user was away, not judged on the transcript the chat cached before it left", () => {
    const cached = lead(40, '2026-09-26T05:57:00.000Z')
    show('2026-09-26T06:00:00.000Z', { messages: cached, agentStatus: pane([rosterRow(OWN_AGENTS.a441.id, Date.parse('2026-09-26T05:00:00.000Z'))]) })
    show('2026-09-26T06:00:10.000Z', { messages: [], agentStatus: pane([]), sessionId: OTHER })
    const rows = [rosterRow(OWN_AGENTS.a441.id, Date.parse('2026-09-26T05:00:00.000Z')), rosterRow(OWN_AGENTS.abe6.id, Date.parse('2026-09-26T06:30:01.000Z'))]
    const painted = show('2026-09-26T08:00:00.000Z', { messages: cached, agentStatus: pane(rows), settled: false })
    const fresh = show('2026-09-26T08:00:02.000Z', { messages: lead(40, '2026-09-26T07:56:40.000Z'), agentStatus: pane(rows) })

    expect(painted).toEqual([OWN_AGENTS.a441.id])
    expect(fresh.sort()).toEqual(rows.map((row) => row.id).sort())
  })

  it("keeps the lead's unnamed shells in the count through a snapshot without a status", () => {
    const messages = ownAgentLaunch(OWN_AGENTS.abe6)
    const abe6 = rosterRow(OWN_AGENTS.abe6.id, Date.parse(OWN_AGENTS.abe6.result))
    show('2026-09-26T00:00:00.000Z', { messages, agentStatus: pane([], 'working', '2026-09-25T22:00:00.000Z', 'monitoring'), onScreenShellCount: 4 })
    const counts = [
      show('2026-09-26T00:01:00.000Z', { messages, agentStatus: pane([abe6], 'working', '2026-09-25T22:00:00.000Z', 'monitoring'), onScreenShellCount: 4 }),
      show('2026-09-26T00:01:05.000Z', { messages, agentStatus: null, onScreenShellCount: 4 }),
      show('2026-09-26T00:01:10.000Z', { messages, agentStatus: pane([abe6], 'working', '2026-09-25T22:00:00.000Z', 'monitoring'), onScreenShellCount: 4 })
    ].map((running) => running.length)

    expect(counts).toEqual([5, 5, 5])
  })
})

describe('which call a result answers', () => {
  const at = (iso: string) => Date.parse(iso)

  it('lets an Agent call that failed at once answer itself, not a long command beside it', () => {
    const turn: NativeChatMessage[] = [
      {
        id: 'calls',
        role: 'assistant',
        timestamp: at('2026-09-26T12:00:10.000Z'),
        source: 'transcript',
        blocks: [
          { type: 'tool-call', name: 'Agent', input: { description: '[audit]', prompt: '[prompt]', subagent_type: 'general-purpose' } },
          { type: 'tool-call', name: 'Bash', input: { command: '[command]', description: '[run the suite]' } }
        ]
      },
      {
        id: 'err',
        role: 'tool',
        timestamp: at('2026-09-26T12:00:10.100Z'),
        source: 'transcript',
        blocks: [{ type: 'tool-result', output: "<tool_use_error>Agent type 'general-purpose' has been denied by permission rule 'Agent(general-purpose)' from projectSettings.</tool_use_error>", isError: true }]
      }
    ]

    expect(readTaskEvidence(turn).pendingAgentCalls).toEqual([])
  })

  it('does not take an id a Read output quotes as the lead launching it', () => {
    const turn: NativeChatMessage[] = [
      {
        id: 'calls',
        role: 'assistant',
        timestamp: at('2026-09-26T10:00:10.000Z'),
        source: 'transcript',
        blocks: [
          { type: 'tool-call', name: 'Agent', input: { description: '[audit]', prompt: '[prompt]', subagent_type: 'general-purpose' } },
          { type: 'tool-call', name: 'Read', input: { file_path: '/x/fixtures/claude-orchestration-2.1.281.ts' } }
        ]
      },
      {
        id: 'read',
        role: 'tool',
        timestamp: at('2026-09-26T10:00:10.300Z'),
        source: 'transcript',
        blocks: [{ type: 'tool-result', output: `37\t  a874: { id: '${NESTED_REVIEWERS.a874.id}' },\n// agentId: ${NESTED_REVIEWERS.a874.id}` }]
      }
    ]

    const evidence = readTaskEvidence(turn)
    expect(evidence.ownAgentIds).toEqual([])
    expect(evidence.pendingAgentCalls.map((call) => call.key)).toEqual(['calls#0'])
  })
})
