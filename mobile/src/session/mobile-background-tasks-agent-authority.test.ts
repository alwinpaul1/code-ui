import { describe, expect, it } from 'vitest'
import type { AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import { deriveBackgroundTasks, type BackgroundTaskHostStatus } from './mobile-background-tasks'
import {
  NESTED_REVIEWERS,
  OWN_AGENTS,
  ROSTER_FIRST_OBSERVED,
  WORKING_AFTER_QUESTION,
  backgroundShellLaunch,
  ownAgentLaunch,
  rosterRow
} from './fixtures/claude-orchestration-2.1.281'

// Replayed from session 967668df (Claude Code 2.1.281) over 23:50–00:34 UTC,
// the three agents the lead launched at 21:58–22:04 were in the phone's
// 150-message window, and the phone dropped them from the count at every turn
// end and brought them back a few seconds later. Two readers were judging
// them that cannot see agents:
//
//   - The status line's `live=` list is built from Bash results in the
//     transcript tail (`"content":"Command running in background…`), so it
//     names shells only. Every time a shell started or finished the list
//     moved, its time was restamped, and every agent launched before that
//     moment was "not on the agent's own list" and retired.
//   - The Stop hook's `run=` does list agents (Claude's `background_tasks`),
//     so at each turn end the agents came back — for one beacon, until the
//     next status-line repaint (≤ 5 s) replaced it with `live=` again.
//
// The host's roster is kept by Claude Code's own SubagentStart/SubagentStop
// hooks and reaped against `background_tasks` at every turn end; it is the
// authority on an agent the host tracks.

const agents = [OWN_AGENTS.a776, OWN_AGENTS.acf3, OWN_AGENTS.adfd]
const window = [
  ...agents.flatMap((agent) => ownAgentLaunch(agent)),
  ...backgroundShellLaunch('bbgtz4rfz', '2026-09-25T23:31:47.167Z', '2026-09-25T23:31:49.604Z')
]
const roster = (): AgentSubagentSnapshot[] =>
  agents.map((agent) => rosterRow(agent.id, ROSTER_FIRST_OBSERVED[agent.id]!, `[description of ${agent.id}]`))
const NOW = Date.parse('2026-09-25T23:56:05.000Z')
const pane: BackgroundTaskHostStatus = { state: 'working', stateStartedAt: WORKING_AFTER_QUESTION, subagents: roster() }

describe("an agent's run is judged by the roster, not by a list of shells", () => {
  it("keeps the session's own agents running when the status line's list of shells moves", () => {
    // 23:55:40: `live=bhcfbe9vf,bbgtz4rfz`, restamped at that moment.
    const tasks = deriveBackgroundTasks(window, NOW, pane, {
      runningTaskIds: ['bhcfbe9vf', 'bbgtz4rfz'],
      runningTaskIdsAt: Date.parse('2026-09-25T23:55:40.000Z'),
      launchedTaskIds: ['bhcfbe9vf', 'bbgtz4rfz']
    })

    expect(tasks.running.map((task) => task.id).sort()).toEqual([...agents.map((agent) => agent.id), 'bbgtz4rfz', 'bhcfbe9vf'].sort())
  })

  it("does not move the count when a turn end's Stop hook list gives way to the status line's", () => {
    // abe6 launched at 23:55:19. The Stop hook at 23:55:34 answered with
    // everything Claude's registry held, the reviewers and their shells
    // included; the status line's next repaint answered with the lead's two
    // shells, and abe6 left the count until the next turn end.
    const turn = [...window, ...ownAgentLaunch(OWN_AGENTS.abe6)]
    const withAbe6: BackgroundTaskHostStatus = {
      ...pane,
      subagents: [...roster(), rosterRow(OWN_AGENTS.abe6.id, ROSTER_FIRST_OBSERVED[OWN_AGENTS.abe6.id]!)]
    }
    const atStop = deriveBackgroundTasks(turn, NOW, withAbe6, {
      runningTaskIds: [
        OWN_AGENTS.a441.id, ...agents.map((agent) => agent.id), 'bhcfbe9vf', 'bbgtz4rfz', OWN_AGENTS.abe6.id,
        'bgnnlu2bm', NESTED_REVIEWERS.aba3.id, NESTED_REVIEWERS.a874.id, 'bnhvwd5g8'
      ],
      runningTaskIdsAt: Date.parse('2026-09-25T23:55:35.000Z'),
      launchedTaskIds: ['bhcfbe9vf', 'bbgtz4rfz']
    }).running
    const afterRepaint = deriveBackgroundTasks(turn, NOW, withAbe6, {
      runningTaskIds: ['bhcfbe9vf', 'bbgtz4rfz'],
      runningTaskIdsAt: Date.parse('2026-09-25T23:55:40.000Z'),
      launchedTaskIds: ['bhcfbe9vf', 'bbgtz4rfz']
    }).running

    expect(afterRepaint.map((task) => task.id)).toContain(OWN_AGENTS.abe6.id)
    expect(afterRepaint).toHaveLength(atStop.length)
  })

  it('keeps an agent running on a list of shells when the host reports no status at all', () => {
    const tasks = deriveBackgroundTasks(window, NOW, null, {
      runningTaskIds: ['bbgtz4rfz'],
      runningTaskIdsAt: Date.parse('2026-09-25T23:55:40.000Z')
    })

    expect(tasks.running.map((task) => task.id).sort()).toEqual([...agents.map((agent) => agent.id), 'bbgtz4rfz'].sort())
  })

  it('shows an agent the lead resumed as running, though an earlier run of it already notified', () => {
    // "A task-notification fires each time this agent stops … The user can
    // send it another message and resume it, so the same task-id may notify
    // more than once" — Claude Code's own note on every agent notification.
    const resumed = OWN_AGENTS.acf3.id
    const tasks = deriveBackgroundTasks(window, NOW, pane, { finishedTaskIds: [resumed] })

    expect(tasks.running.map((task) => task.id)).toContain(resumed)
  })
})

describe("an agent's own notification against a roster row", () => {
  // Orca re-creates a one-shot agent's row on every SubagentStart, so a
  // resumed agent's row starts after the notification of its previous run. A
  // row that started before the notification is the run the notification
  // ended: a phantom Orca kept because it missed the SubagentStop (it was down
  // when the agent finished, and restored the row from its snapshot).
  const notified = (id: string, iso: string) => ({
    id: `note-${id}`,
    role: 'user' as const,
    timestamp: Date.parse(iso),
    source: 'transcript' as const,
    blocks: [
      {
        type: 'text' as const,
        text: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>Agent "[description of ${id}]" finished</summary>\n</task-notification>`
      }
    ]
  })
  const launched = ownAgentLaunch(OWN_AGENTS.abe6)
  const later = Date.parse('2026-09-26T00:40:00.000Z')

  it('retires an agent whose notification came after its roster row started', () => {
    const phantom: BackgroundTaskHostStatus = {
      state: 'working',
      subagents: [rosterRow(OWN_AGENTS.abe6.id, Date.parse(OWN_AGENTS.abe6.result))]
    }
    const tasks = deriveBackgroundTasks([...launched, notified(OWN_AGENTS.abe6.id, '2026-09-26T00:30:00.000Z')], later, phantom)

    expect(tasks.running).toEqual([])
    expect(tasks.finished.map((task) => [task.id, task.status])).toEqual([[OWN_AGENTS.abe6.id, 'completed']])
  })

  it('keeps a named agent running that the lead resumed, whose row keeps its first start', () => {
    // A named agent's id is `a<name>-<hex>`. Orca only idles such a row at a
    // SubagentStop and flips the same row back to working on the resume, old
    // `startedAt` and all (claude-subagent-roster.ts), so its start says
    // nothing about which run a notification ended.
    const id = 'areviewer-0123456789abcdef'
    const turn = [
      ...ownAgentLaunch({ id, call: '2026-09-26T09:00:00.000Z', result: '2026-09-26T09:00:02.000Z' }),
      notified(id, '2026-09-26T09:10:00.000Z')
    ]
    const tasks = deriveBackgroundTasks(turn, Date.parse('2026-09-26T09:13:00.000Z'), {
      state: 'working',
      subagents: [rosterRow(id, Date.parse('2026-09-26T09:00:01.000Z'))]
    })

    expect(tasks.running.map((task) => task.id)).toEqual([id])
  })

  it('keeps an agent running whose row started after its last notification', () => {
    const resumed: BackgroundTaskHostStatus = {
      state: 'working',
      subagents: [rosterRow(OWN_AGENTS.abe6.id, Date.parse('2026-09-26T00:35:00.000Z'))]
    }
    const tasks = deriveBackgroundTasks([...launched, notified(OWN_AGENTS.abe6.id, '2026-09-26T00:30:00.000Z')], later, resumed)

    expect(tasks.running.map((task) => task.id)).toEqual([OWN_AGENTS.abe6.id])
  })
})

describe('a question the lead asked does not end the work it launched before', () => {
  // The pane's working start moves whenever its state changes, `waiting`
  // included: the lead's question at 23:23:06 and its answer at 23:24:06
  // started a new `working` while four agents and bhll6so5h (launched
  // 23:14:48, finished 23:25:30) ran on. "Launched before the current working
  // run" retired every one of them.
  const beforeQuestion = [
    ...ownAgentLaunch(OWN_AGENTS.a776),
    ...backgroundShellLaunch('bhll6so5h', '2026-09-25T23:14:47.900Z', '2026-09-25T23:14:48.431Z')
  ]
  const atAnswer = Date.parse('2026-09-25T23:25:00.000Z')
  const answered: BackgroundTaskHostStatus = {
    state: 'working',
    stateStartedAt: WORKING_AFTER_QUESTION,
    subagents: [rosterRow(OWN_AGENTS.a776.id, ROSTER_FIRST_OBSERVED[OWN_AGENTS.a776.id]!)]
  }

  it("keeps an agent the roster still lists and a shell the status line still lists", () => {
    const tasks = deriveBackgroundTasks(beforeQuestion, atAnswer, answered, {
      runningTaskIds: ['bhll6so5h'],
      runningTaskIdsAt: Date.parse('2026-09-25T23:24:30.000Z'),
      launchedTaskIds: ['bhll6so5h']
    })

    expect(tasks.running.map((task) => task.id)).toEqual([OWN_AGENTS.a776.id, 'bhll6so5h'])
  })

  it('keeps a shell launched before the question running on a tab with no beacon, when the phone saw the run begin', () => {
    // The phone watched the pane go working at 21:00, waiting at 23:23:06 and
    // working again at 23:24:06, so the run everything since 21:00 belongs to
    // did not end at the question (use-active-tab-task-report.ts).
    const tasks = deriveBackgroundTasks(beforeQuestion, atAnswer, answered, { runBoundaryAt: Date.parse('2026-09-25T21:00:00.000Z') })

    expect(tasks.running.map((task) => task.id)).toEqual([OWN_AGENTS.a776.id, 'bhll6so5h'])
  })

  it("does not keep a finished shell running on a footer its subagents' shells fill", () => {
    // b3alquujb, launched 22:42:29, finished mid-turn at 22:45:51 as an
    // attachment Orca's reader drops. With reviewers running their own test
    // shells the footer read 3, which says nothing about the lead's; the run
    // boundary is still the only evidence the phone has for it.
    const finishedUnseen = [
      ...ownAgentLaunch(OWN_AGENTS.a776),
      ...backgroundShellLaunch('b3alquujb', '2026-09-25T22:42:29.000Z', '2026-09-25T22:42:30.500Z')
    ]
    const tasks = deriveBackgroundTasks(finishedUnseen, atAnswer, answered, { onScreenShellCount: 3 })

    expect(tasks.running.map((task) => task.id)).toEqual([OWN_AGENTS.a776.id])
  })

  it('still retires a shell from before the working run when nothing else can speak for it', () => {
    // No beacon, no footer on screen: the run boundary is the only evidence
    // there is, as it was on 2026-09-09 (eight-hour-old shells shown running).
    const tasks = deriveBackgroundTasks(beforeQuestion, atAnswer, answered, {})

    expect(tasks.running.map((task) => task.id)).toEqual([OWN_AGENTS.a776.id])
  })
})
