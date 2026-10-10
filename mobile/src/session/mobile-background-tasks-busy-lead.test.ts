import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import { parseAgentHudBeaconPayload } from './agent-hud-beacon'
import { parseClaudeRunningShellCount } from './claude-footer-shell-count'
import { deriveBackgroundTasks, type BackgroundTask, type BackgroundTasks } from './mobile-background-tasks'
import { mergeSubagentActivity } from './mobile-subagent-activity'
import { orcaTranscriptRows, recordsThrough } from './fixtures/claude-subagent-transcripts-2.1.296'
import {
  BUSY_LAUNCHED_AT,
  LEAD_SHELL_A,
  LEAD_SHELL_B,
  QUICK_AGENT,
  QUICK_AGENT_SHELL,
  SLOW_AGENT,
  busyBeaconPayloads,
  busyRecords,
  busyScreen
} from './fixtures/claude-busy-lead-tasks-2.1.296'

// A busy lead's background work ending under it, Claude Code 2.1.296, recorded live
// (fixtures/claude-busy-lead-tasks-2.1.296.ts). The lead's transcript as Orca serves
// it holds the launches and NOT ONE completion: each was queued while the lead sat in
// its own foreground ping, and delivered as an attachment Orca's reader drops.

const at = (iso: string) => Date.parse(iso)
const lead = () => orcaTranscriptRows(busyRecords('lead'))
type Row = NonNullable<AgentStatusEntry['subagents']>[number]
const row = (id: string, startedAt: string): Row => ({ id, agentType: 'general-purpose', state: 'working', startedAt: at(startedAt) })
const working = (subagents: Row[]) => ({ state: 'working' as const, subagents })

const ids = (tasks: readonly BackgroundTask[]) => tasks.map((task) => task.id)

describe("the lead's transcript alone cannot see a mid-turn completion", () => {
  it('holds every launch and no notification', () => {
    expect(JSON.stringify(lead())).not.toContain('task-notification')
  })
})

describe("a background agent's row reads its description unless a tool call is in flight", () => {
  const agentRow = (id: string, title: string, now: number): BackgroundTask => ({
    id,
    kind: 'agent',
    title,
    status: 'running',
    startedAt: BUSY_LAUNCHED_AT,
    elapsedMs: now - BUSY_LAUNCHED_AT
  })
  const tasks = (now: number): BackgroundTasks => ({
    running: [agentRow(QUICK_AGENT, 'Busy probe quick', now), agentRow(SLOW_AGENT, 'Busy probe slow', now)],
    finished: []
  })

  it('titles the slow agent "Running ping -c 50 127.0.0.1" while its ping has no answer yet', () => {
    // 23:04:35: the slow agent's ping was sent at 23:04:12.4 and answered at 23:05:02.
    const now = at('2026-10-10T23:04:35.000Z')
    const slow = orcaTranscriptRows(recordsThrough(busyRecords('agent-slow'), '2be5402f'))
    const merged = mergeSubagentActivity(tasks(now), new Map([[SLOW_AGENT, slow]]), { now })
    const card = merged.running.find((task) => task.id === SLOW_AGENT)!
    expect(card.latestStep).toBe('Running ping -c 50 127.0.0.1')
    expect(card.title).toBe('Busy probe slow')
  })

  it("keeps the quick agent's description once its launch of a background sleep was answered", () => {
    // 23:04:13: the quick agent's only call (the background `sleep 25`) answered at
    // 23:04:12.1 and its hand-back text written; no call is in flight. Claude's own
    // panel and the Claude app show the description here, not the finished call.
    const now = at('2026-10-10T23:04:13.320Z')
    const quick = orcaTranscriptRows(recordsThrough(busyRecords('agent-quick'), 'aec3e518'))
    const merged = mergeSubagentActivity(tasks(now), new Map([[QUICK_AGENT, quick]]), { now })
    const card = merged.running.find((task) => task.id === QUICK_AGENT)!
    expect(card.latestStep).toBeUndefined()
    expect(card.title).toBe('Busy probe quick')
  })

  it('reads the description again once the in-flight ping is answered', () => {
    const now = at('2026-10-10T23:05:03.000Z')
    const slow = orcaTranscriptRows(recordsThrough(busyRecords('agent-slow'), 'a2296a5b'))
    const merged = mergeSubagentActivity(tasks(now), new Map([[SLOW_AGENT, slow]]), { now })
    expect(merged.running.find((task) => task.id === SLOW_AGENT)!.latestStep).toBeUndefined()
  })
})

describe('an agent resumed after it handed back is timed from its current run', () => {
  it('times the quick agent from its resume at 23:04:37, not from its launch at 23:04:09', () => {
    // Its shell's end resumed it (SubagentStart again at 23:04:37.182); Orca drops a
    // stopped row and stamps its return anew, and the phone's run clock saw it come
    // back. The Claude app times the row from there ("Fix markdown … 50s" beside an
    // agent launched an hour before, the user's screenshots of 2026-10-11).
    const now = at('2026-10-10T23:04:38.000Z')
    const resumedAt = at('2026-10-10T23:04:37.182Z')
    const tasks = deriveBackgroundTasks(
      lead(),
      now,
      working([row(QUICK_AGENT, '2026-10-10T23:04:37.182Z'), row(SLOW_AGENT, '2026-10-10T23:04:10.685Z')]),
      { subagentRuns: new Map([[QUICK_AGENT, resumedAt], [SLOW_AGENT, null]]) }
    )
    const quick = tasks.running.find((task) => task.id === QUICK_AGENT)!
    expect(quick.elapsedMs).toBe(now - resumedAt)
    // A run the clock cannot place keeps its launch time.
    const slow = tasks.running.find((task) => task.id === SLOW_AGENT)!
    expect(slow.startedAt).toBe(at('2026-10-10T23:04:10.513Z'))
  })
})

describe("the footer's own zero retires finished shells on a tab with no beacon", () => {
  it('reads the no-count footer, which says "(shift+tab to cycle)" where the pill was, as zero shells', () => {
    expect(parseClaudeRunningShellCount(busyScreen('screen-footer-no-count.txt'))).toBe(0)
    expect(parseClaudeRunningShellCount(busyScreen('screen-footer-no-count.txt', { dropBlank: true }))).toBe(0)
    expect(parseClaudeRunningShellCount(busyScreen('screen-footer-one-shell.txt'))).toBe(1)
  })

  it('does not read zero off a footer too narrow to hold the pill, nor off a focused pill', () => {
    expect(parseClaudeRunningShellCount(busyScreen('screen-footer-48.txt'))).toBe(2)
    expect(parseClaudeRunningShellCount(busyScreen('screen-footer-40.txt'))).toBe(2)
    // "· 2 s": the pill itself cut, and no hint in its place.
    expect(parseClaudeRunningShellCount(busyScreen('screen-footer-34.txt'))).toBeNull()
    // The pill gone entirely at 28 columns while two shells ran.
    expect(parseClaudeRunningShellCount(busyScreen('screen-footer-28.txt'))).toBeNull()
    expect(parseClaudeRunningShellCount(busyScreen('screen-shells-pill-focused.txt'))).toBe(2)
    // A dialog over the footer.
    expect(parseClaudeRunningShellCount(busyScreen('screen-dialog-two-shells-one-agent.txt'))).toBeNull()
  })

  it('moves both lead shells to Finished once the footer shows no count, with no beacon at all', () => {
    // 23:04:58.8: shell B ended at 23:04:54.4, A at 23:04:29.1, the slow agent still
    // pinging. A hand-started `claude` (no launch flag, so no done= and no run=) had
    // only this screen to say so; before, both stayed "running" for as long as the lead
    // kept working.
    const now = at('2026-10-10T23:04:58.800Z')
    const tasks = deriveBackgroundTasks(lead(), now, working([row(SLOW_AGENT, '2026-10-10T23:04:10.685Z')]), {
      onScreenShellCount: parseClaudeRunningShellCount(busyScreen('screen-footer-no-count.txt'))
    })
    expect(ids(tasks.running)).toEqual([SLOW_AGENT])
    expect(tasks.finished.filter((task) => task.kind === 'shell').map((task) => [task.id, task.status])).toEqual(
      expect.arrayContaining([
        [LEAD_SHELL_A, 'finished'],
        [LEAD_SHELL_B, 'finished']
      ])
    )
  })
})

describe('with the beacon, every finished task leaves Running (pin, already true on main)', () => {
  it("retires both shells and both agents by done= and Orca's roster, mid-turn", () => {
    const last = parseAgentHudBeaconPayload(busyBeaconPayloads().findLast((line) => line.includes(SLOW_AGENT))!)
    const done = last?.doneTaskIds ?? []
    expect(done).toEqual(expect.arrayContaining([LEAD_SHELL_A, LEAD_SHELL_B, QUICK_AGENT, QUICK_AGENT_SHELL, SLOW_AGENT]))
    // 23:05:10: the lead still in its ping; Orca's roster empty after the last
    // SubagentStop (23:05:04.4).
    const tasks = deriveBackgroundTasks(lead(), at('2026-10-10T23:05:10.000Z'), working([]), { finishedTaskIds: done })
    expect(tasks.running).toEqual([])
    expect(ids(tasks.finished).toSorted()).toEqual([LEAD_SHELL_A, LEAD_SHELL_B, QUICK_AGENT, SLOW_AGENT].toSorted())
  })
})
