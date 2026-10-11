import { describe, expect, it } from 'vitest'
import { parseClaudeRunningShellCount } from './claude-footer-shell-count'
import { deriveBackgroundTasks, type BackgroundTaskHostStatus } from './mobile-background-tasks'
import { APPROVAL_0158, IDLE_AFTER_TURN_0158, WORKING_0158 } from './fixtures/codex-composer-screens'
import {
  PROBE_A,
  PROBE_B,
  PROBE_D,
  SUBAGENT_SHELL_SCREEN,
  TWO_SUBAGENT_SHELLS_SCREEN,
  probeDLaunch,
  screenRows,
  twoAgentLaunches,
  workingRow
} from './fixtures/claude-subagent-shells-2.1.296'

// Claude Code 2.1.296, 2026-10-10 (fixtures/claude-subagent-shells-2.1.296.ts).
// A shell a background subagent starts is recorded only in that subagent's
// transcript, and Orca's roster carries no tool or step for a subagent. The
// footer's "· N shells" counts every shell in the process. From 2026-10-10 the
// sheet drew what it counted beyond the lead as "+2 shells in subagents"; on
// 2026-10-11 the user asked for that line gone, and the count was found to hold
// shells finished subagents had left running too (session 0954729d), which the
// Claude app does not list. The lead's reader now makes nothing of the
// surplus: a subagent's shells are rows only where its own transcript is read
// (`mobile-subagent-activity.ts`).

const pane = (...rows: ReturnType<typeof workingRow>[]): BackgroundTaskHostStatus => ({ state: 'working', subagents: rows })
const shells = (tasks: ReturnType<typeof deriveBackgroundTasks>) => tasks.running.filter((task) => task.kind === 'shell')

describe("shells started inside the lead's subagents, on the lead's own reader", () => {
  it('reads the footer count off the real screen while two subagents each run a shell', () => {
    expect(parseClaudeRunningShellCount(screenRows(TWO_SUBAGENT_SHELLS_SCREEN))).toBe(2)
    expect(parseClaudeRunningShellCount(screenRows(SUBAGENT_SHELL_SCREEN))).toBe(1)
  })

  it('lists the two agents and makes up no shell row or count when the lead started none and the footer counts two', () => {
    const now = Date.parse('2026-10-10T16:24:07.000Z')
    const tasks = deriveBackgroundTasks(
      twoAgentLaunches(),
      now,
      pane(workingRow(PROBE_A, '2026-10-10T16:23:43.000Z'), workingRow(PROBE_B, '2026-10-10T16:23:43.000Z')),
      { onScreenShellCount: parseClaudeRunningShellCount(screenRows(TWO_SUBAGENT_SHELLS_SCREEN)) }
    )

    expect(tasks.running.map((task) => [task.kind, task.title])).toEqual([
      ['agent', 'Sleep probe A'],
      ['agent', 'Sleep probe B']
    ])
    expect(Object.keys(tasks).sort()).toEqual(['finished', 'running'])
  })

  it("lists only Probe D after the lead's own shell has reported, with the footer counting D's shell", () => {
    const now = Date.parse('2026-10-10T16:29:15.000Z')
    const tasks = deriveBackgroundTasks(probeDLaunch(), now, pane(workingRow(PROBE_D, '2026-10-10T16:28:37.000Z')), {
      onScreenShellCount: parseClaudeRunningShellCount(screenRows(SUBAGENT_SHELL_SCREEN))
    })

    expect(tasks.running.map((task) => task.title)).toEqual(['Probe D'])
    expect(Object.keys(tasks).sort()).toEqual(['finished', 'running'])
  })

  it('makes up no shell row while no subagent runs, nor with the footer off screen, nor on an empty window', () => {
    const idle = deriveBackgroundTasks(twoAgentLaunches(), Date.parse('2026-10-10T16:25:00.000Z'), { state: 'working', subagents: [] }, {
      onScreenShellCount: 2
    })
    const held = deriveBackgroundTasks(twoAgentLaunches(), Date.parse('2026-10-10T16:24:07.000Z'), pane(workingRow(PROBE_A, '2026-10-10T16:23:43.000Z')), {
      onScreenShellCount: null,
      heldOnScreenShellCount: { count: 2, at: Date.parse('2026-10-10T16:24:00.000Z') }
    })

    expect(shells(idle)).toEqual([])
    expect(shells(held)).toEqual([])
    expect(deriveBackgroundTasks([], 0, null, { onScreenShellCount: null })).toEqual({ running: [], finished: [] })
  })

  it('never reads a count off a Codex screen, which paints no shell count', () => {
    for (const screen of [WORKING_0158, IDLE_AFTER_TURN_0158, APPROVAL_0158]) {
      const count = parseClaudeRunningShellCount(screen)
      expect(count).toBeNull()
      expect(deriveBackgroundTasks([], 0, { state: 'working', subagents: [] }, { onScreenShellCount: count })).toEqual({ running: [], finished: [] })
    }
  })
})
