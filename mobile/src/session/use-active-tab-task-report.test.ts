import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry, AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  NESTED_REVIEWERS,
  OWN_AGENTS,
  ROSTER_FIRST_OBSERVED,
  backgroundShellLaunch,
  leadTurn,
  movedToBackgroundLaunch,
  ownAgentLaunch,
  rosterRow,
  sendMessage,
  taskStop
} from './fixtures/claude-orchestration-2.1.281'
import { deriveReportedBackgroundTasks } from './mobile-reported-background-tasks'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'
import { HELD_AGENT_STATUS_MAX_AGE_MS, resetTaskEvidenceForTests, useActiveTabTaskReport } from './use-active-tab-task-report'

// The phone's running-task count reads sources that each look away now and
// then: the loaded window slides past a launch or a TaskStop, a tab snapshot
// comes without its host status, a dialog covers the agent's footer. These
// drive the hook the controller uses with those moments, from session 967668df
// (Claude Code 2.1.281), and read the count the status line would show.

const SESSION = '967668df-a7d9-40e7-964b-7812815c010d'
const EMPTY_REPORT: ActiveTabBackgroundTaskReport = {
  finishedTaskIds: [],
  runningTaskIds: null,
  runningTaskIdsAt: null,
  launchedTaskIds: []
}

type Frame = {
  /** The phone clock this render reads, set by `show`. */
  now?: number
  messages: readonly NativeChatMessage[]
  agentStatus: AgentStatusEntry | null
  report?: ActiveTabBackgroundTaskReport
  onScreenShellCount?: number | null
  agent?: string
  sessionId?: string | null
}

let latest: string[] = []
function Probe({ frame }: { frame: Frame }) {
  const report = useActiveTabTaskReport({
    report: frame.report ?? EMPTY_REPORT,
    handle: 'pty-1',
    sessionId: frame.sessionId === undefined ? SESSION : frame.sessionId,
    agent: frame.agent ?? 'claude',
    messages: frame.messages,
    agentStatus: frame.agentStatus,
    onScreenShellCount: frame.onScreenShellCount ?? null,
    screenTaskCompletions: []
  })
  latest = deriveReportedBackgroundTasks(frame.messages, frame.now ?? 0, frame.agentStatus, report).running.map((task) => task.id)
  return null
}

/** The session's entry in Orca's last-status.json, reduced to what the
 *  reader looks at (its pane key is the real one). */
function status(subagents: AgentSubagentSnapshot[]): AgentStatusEntry {
  return {
    state: 'working',
    prompt: '',
    updatedAt: Date.now(),
    stateStartedAt: Date.parse('2026-09-25T21:00:00.000Z'),
    paneKey: 'facefdf7-1930-4cee-a501-5e56fbf26317:8d01a29d-f9c9-48d8-91a2-0f96f9f7bcb9',
    stateHistory: [],
    subagents
  }
}
const own = (agent: { id: string }) => rosterRow(agent.id, ROSTER_FIRST_OBSERVED[agent.id] ?? Date.now())
const reviewer = (entry: { id: string; first: string }) => rosterRow(entry.id, Date.parse(entry.first))
const filler = (count: number, from: string) =>
  Array.from({ length: count }, (_unused, index) => leadTurn(new Date(Date.parse(from) + index * 1000).toISOString()))

describe('what the running-task count keeps when a source looks away', () => {
  let renderer: ReactTestRenderer | null = null
  beforeEach(() => {
    resetTaskEvidenceForTests()
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-09-26T00:20:30.000Z'))
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  function show(shown: Frame): string[] {
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

  it('keeps a stopped shell finished after its TaskStop scrolls out of the loaded window', () => {
    // bhcfbe9vf was stopped at 00:20:27; no notification ever follows a stop,
    // and the status line kept naming it in `bg=` and `live=`.
    const beacon: ActiveTabBackgroundTaskReport = {
      ...EMPTY_REPORT,
      runningTaskIds: ['bhcfbe9vf'],
      runningTaskIdsAt: Date.parse('2026-09-26T00:20:00.000Z'),
      launchedTaskIds: ['bhcfbe9vf']
    }
    const withStop = [
      ...movedToBackgroundLaunch('bhcfbe9vf', '2026-09-25T23:24:54.203Z', '2026-09-25T23:26:57.378Z'),
      ...taskStop('bhcfbe9vf', '2026-09-26T00:20:27.659Z', '2026-09-26T00:20:27.733Z')
    ]
    expect(show({ messages: withStop, agentStatus: status([]), report: beacon })).toEqual([])

    const scrolledPast = filler(3, '2026-09-26T00:21:00.000Z')
    expect(show({ messages: scrolledPast, agentStatus: status([]), report: beacon })).toEqual([])
  })

  it('keeps counting the lead’s agent after its launch scrolls out, and never the reviewer it starts', () => {
    // The first look comes before abe6's SubagentStart reached the roster;
    // then abe6 alone; then, minutes later, a3a4 starts while abe6 is there
    // to have started it and the window still reaches back past it with no
    // launch of it: a reviewer.
    const launched = ownAgentLaunch(OWN_AGENTS.abe6)
    show({ messages: launched, agentStatus: status([]) })
    show({ messages: launched, agentStatus: status([own(OWN_AGENTS.abe6)]) })
    vi.setSystemTime(Date.now() + 120_000)
    const covered = show({
      messages: [...launched, leadTurn('2026-09-25T23:59:50.000Z')],
      agentStatus: status([own(OWN_AGENTS.abe6), reviewer(NESTED_REVIEWERS.a3a4)])
    })

    const later = show({
      messages: filler(3, '2026-09-26T00:10:00.000Z'),
      agentStatus: status([own(OWN_AGENTS.abe6), reviewer(NESTED_REVIEWERS.a3a4)])
    })
    expect(covered).toEqual([OWN_AGENTS.abe6.id])
    expect(later).toEqual([OWN_AGENTS.abe6.id])
  })

  it('gives the rows already running at the first look the benefit of the doubt, and no later row', () => {
    const firstLook = show({ messages: [], agentStatus: status([own(OWN_AGENTS.a441), reviewer(NESTED_REVIEWERS.a874)]) })
    expect(firstLook.sort()).toEqual([OWN_AGENTS.a441.id, NESTED_REVIEWERS.a874.id].sort())

    const reviewerStarts = show({
      messages: [],
      agentStatus: status([own(OWN_AGENTS.a441), reviewer(NESTED_REVIEWERS.a874), reviewer(NESTED_REVIEWERS.a3a4)])
    })
    expect(reviewerStarts.sort()).toEqual([OWN_AGENTS.a441.id, NESTED_REVIEWERS.a874.id].sort())
  })

  it('stops giving the doubt to a first-look row once it stops, so its parent resuming it does not count', () => {
    // a874 was running at the first look, finished at 00:03:54, and adfd (its
    // parent, one of the lead's agents) resumed it at 00:27:07.
    show({ messages: [], agentStatus: status([own(OWN_AGENTS.adfd), reviewer(NESTED_REVIEWERS.a874)]) })
    show({ messages: [], agentStatus: status([own(OWN_AGENTS.adfd)]) })

    const resumedByParent = show({ messages: [], agentStatus: status([own(OWN_AGENTS.adfd), reviewer(NESTED_REVIEWERS.a874)]) })
    expect(resumedByParent).toEqual([OWN_AGENTS.adfd.id])
  })

  it('keeps the doubt through a snapshot that came without a host status', () => {
    show({ messages: [], agentStatus: status([own(OWN_AGENTS.a441)]) })
    show({ messages: [], agentStatus: null })

    expect(show({ messages: [], agentStatus: status([own(OWN_AGENTS.a441)]) })).toEqual([OWN_AGENTS.a441.id])
  })

  it('counts an agent the lead resumed with SendMessage, which no new launch names', () => {
    show({ messages: [], agentStatus: status([]) })
    const window = [leadTurn('2026-09-25T23:20:00.000Z'), ...sendMessage(OWN_AGENTS.acf3.id, '2026-09-26T00:15:00.000Z')]
    show({ messages: window, agentStatus: status([own(OWN_AGENTS.acf3)]) })

    // Minutes later acf3 starts aba3. The window reaches back past aba3's
    // start (23:26:56) and shows no launch of it, so aba3 is a reviewer; acf3
    // has the lead's SendMessage.
    vi.setSystemTime(Date.now() + 120_000)
    const resumed = show({
      messages: window,
      agentStatus: status([own(OWN_AGENTS.acf3), reviewer(NESTED_REVIEWERS.aba3)])
    })
    expect(resumed).toEqual([OWN_AGENTS.acf3.id])
  })

  it('does not drop the agents for a tab snapshot that came without its host status', () => {
    const roster = status([own(OWN_AGENTS.a441), own(OWN_AGENTS.a776)])
    expect(show({ messages: [], agentStatus: roster })).toHaveLength(2)

    vi.setSystemTime(Date.now() + 5_000)
    expect(show({ messages: [], agentStatus: null })).toHaveLength(2)

    vi.setSystemTime(Date.now() + HELD_AGENT_STATUS_MAX_AGE_MS)
    expect(show({ messages: [], agentStatus: null })).toEqual([])
  })

  it('keeps a shell the footer retired finished while a dialog covers the footer', () => {
    // Hand-started tab: no beacon. The footer said 1 shell for 2 named.
    const shells = [
      ...movedToBackgroundLaunch('bhcfbe9vf', '2026-09-25T23:24:54.203Z', '2026-09-25T23:26:57.378Z'),
      ...backgroundShellLaunch('bbgtz4rfz', '2026-09-25T23:31:47.167Z', '2026-09-25T23:31:49.604Z')
    ]
    expect(show({ messages: shells, agentStatus: status([]), onScreenShellCount: 1 })).toEqual(['bbgtz4rfz'])

    vi.setSystemTime(Date.now() + 30_000)
    expect(show({ messages: shells, agentStatus: status([]), onScreenShellCount: null })).toEqual(['bbgtz4rfz'])
  })

  it("takes a Codex tab's roster as it stands, and bridges its missing status too", () => {
    const codex = status([rosterRow('019a0d5e-3c4f-7aa1-9b1e-5f2c8d7e6a10', Date.now() - 60_000)])
    expect(show({ messages: [], agentStatus: codex, agent: 'codex' })).toHaveLength(1)

    const childStarts = status([...(codex.subagents ?? []), rosterRow('019a0d5f-8b21-7c3e-a4d6-2e9f1b0c7d55', Date.now())])
    expect(show({ messages: [], agentStatus: childStarts, agent: 'codex' })).toHaveLength(2)

    vi.setSystemTime(Date.now() + 5_000)
    expect(show({ messages: [], agentStatus: null, agent: 'codex' })).toHaveLength(2)
  })

  it("starts a new session with nothing another session's lead launched", () => {
    show({ messages: ownAgentLaunch(OWN_AGENTS.abe6), agentStatus: status([]) })

    const other = show({
      messages: [],
      agentStatus: status([]),
      sessionId: 'b1d1c0de-0000-4000-8000-000000000000'
    })
    const otherLater = show({
      messages: [],
      agentStatus: status([own(OWN_AGENTS.abe6)]),
      sessionId: 'b1d1c0de-0000-4000-8000-000000000000'
    })
    expect(other).toEqual([])
    expect(otherLater).toEqual([])
  })

  it('places nothing while the session is not known yet, and counts the roster as it stands', () => {
    expect(show({ messages: [], agentStatus: status([reviewer(NESTED_REVIEWERS.a3a4)]), sessionId: null })).toEqual([
      NESTED_REVIEWERS.a3a4.id
    ])
  })
})
