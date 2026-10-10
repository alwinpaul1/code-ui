import { describe, expect, it } from 'vitest'
import { parseClaudeRunningShellCount } from './claude-footer-shell-count'
import { deriveBackgroundTasks, type BackgroundTaskHostStatus } from './mobile-background-tasks'
import { subagentShellsLabel } from './mobile-background-task-footer'
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
// transcript, which the phone may not read, and Orca's roster carries no
// tool or step for a subagent. The one place the lead's screen says it exists
// is the footer's "· N shells", which counts every shell in the process. The
// phone may say how many of those are not the lead's, and nothing more.

const pane = (...rows: ReturnType<typeof workingRow>[]): BackgroundTaskHostStatus => ({ state: 'working', subagents: rows })

describe("shells started inside the lead's subagents", () => {
  it('reads the footer count off the real screen while two subagents each run a shell', () => {
    expect(parseClaudeRunningShellCount(screenRows(TWO_SUBAGENT_SHELLS_SCREEN))).toBe(2)
    expect(parseClaudeRunningShellCount(screenRows(SUBAGENT_SHELL_SCREEN))).toBe(1)
  })

  it('says two shells run in subagents when the lead started none and the footer counts two', () => {
    const now = Date.parse('2026-10-10T16:24:07.000Z')
    const tasks = deriveBackgroundTasks(
      twoAgentLaunches(),
      now,
      pane(workingRow(PROBE_A, '2026-10-10T16:23:43.000Z'), workingRow(PROBE_B, '2026-10-10T16:23:43.000Z')),
      { onScreenShellCount: parseClaudeRunningShellCount(screenRows(TWO_SUBAGENT_SHELLS_SCREEN)) }
    )

    // The agents keep their own rows; no shell row is made up for what the
    // subagents run, because nothing names those shells.
    expect(tasks.running.map((task) => [task.kind, task.title])).toEqual([
      ['agent', 'Sleep probe A'],
      ['agent', 'Sleep probe B']
    ])
    expect(tasks.shellsInSubagents).toBe(2)
  })

  it("says one shell runs in a subagent after the lead's own shell has reported", () => {
    const now = Date.parse('2026-10-10T16:29:15.000Z')
    const tasks = deriveBackgroundTasks(probeDLaunch(), now, pane(workingRow(PROBE_D, '2026-10-10T16:28:37.000Z')), {
      onScreenShellCount: parseClaudeRunningShellCount(screenRows(SUBAGENT_SHELL_SCREEN))
    })

    expect(tasks.running.map((task) => task.title)).toEqual(['Probe D'])
    expect(tasks.shellsInSubagents).toBe(1)
  })

  it('says nothing while no subagent runs: then every shell the footer counts is listed as the lead\'s', () => {
    // The fit pads unnamed lead shells up to the footer's count when no
    // subagent can own any of them, so nothing is left over to attribute.
    const tasks = deriveBackgroundTasks(twoAgentLaunches(), Date.parse('2026-10-10T16:25:00.000Z'), { state: 'working', subagents: [] }, {
      onScreenShellCount: 2
    })

    expect(tasks.shellsInSubagents).toBeUndefined()
  })

  it('says nothing when the footer is off screen, even with a count held from before', () => {
    const tasks = deriveBackgroundTasks(
      twoAgentLaunches(),
      Date.parse('2026-10-10T16:24:07.000Z'),
      pane(workingRow(PROBE_A, '2026-10-10T16:23:43.000Z')),
      { onScreenShellCount: null, heldOnScreenShellCount: { count: 2, at: Date.parse('2026-10-10T16:24:00.000Z') } }
    )

    expect(tasks.shellsInSubagents).toBeUndefined()
  })

  it('says nothing when the footer counts no more shells than the lead has named', () => {
    const tasks = deriveBackgroundTasks(probeDLaunch(), Date.parse('2026-10-10T16:29:15.000Z'), pane(workingRow(PROBE_D, '2026-10-10T16:28:37.000Z')), {
      onScreenShellCount: 0
    })

    expect(tasks.shellsInSubagents).toBeUndefined()
  })

  it('says nothing on an empty window with no roster', () => {
    expect(deriveBackgroundTasks([], 0, null, { onScreenShellCount: null }).shellsInSubagents).toBeUndefined()
  })

  it('never reads a count off a Codex screen, which paints no shell count', () => {
    for (const screen of [WORKING_0158, IDLE_AFTER_TURN_0158, APPROVAL_0158]) {
      const count = parseClaudeRunningShellCount(screen)
      expect(count).toBeNull()
      expect(deriveBackgroundTasks([], 0, { state: 'working', subagents: [] }, { onScreenShellCount: count }).shellsInSubagents).toBeUndefined()
    }
  })

  it('words the line by its count', () => {
    expect(subagentShellsLabel(1)).toBe('+1 shell in subagents')
    expect(subagentShellsLabel(2)).toBe('+2 shells in subagents')
  })
})
