import { describe, expect, it } from 'vitest'
import { deriveBackgroundTasks, type BackgroundTaskHostStatus } from './mobile-background-tasks'
import {
  OWN_AGENTS,
  ROSTER_FIRST_OBSERVED,
  backgroundShellLaunch,
  movedToBackgroundLaunch,
  rosterRow
} from './fixtures/claude-orchestration-2.1.281'

// Claude Code's footer pill ("⏵⏵ auto mode on · 5 shells · ← for agents") is
// drawn from every running background task in the process's one registry,
// filtered only by kind (`yX` in 2.1.281, `MJ` in 2.1.283: no local_workflow,
// no ambient monitor, and no agents while the agent panel is on). No owner
// check: a shell a subagent started is in it too. In session 967668df at
// 00:00:05 the footer read 6 shells while the lead had two of its own; the
// phone padded four unnamed "Background shell" rows into the count, and they
// came and went with every reviewer's test run.

const lead = [
  ...movedToBackgroundLaunch('bhcfbe9vf', '2026-09-25T23:24:54.203Z', '2026-09-25T23:26:57.378Z'),
  ...backgroundShellLaunch('bbgtz4rfz', '2026-09-25T23:31:47.167Z', '2026-09-25T23:31:49.604Z')
]
const NOW = Date.parse('2026-09-26T00:00:05.000Z')
const withAgent: BackgroundTaskHostStatus = {
  state: 'working',
  subagents: [rosterRow(OWN_AGENTS.a776.id, ROSTER_FIRST_OBSERVED[OWN_AGENTS.a776.id]!)]
}

describe("the agent's footer count of shells", () => {
  it("does not pad the session's count with shells its subagents are running", () => {
    const tasks = deriveBackgroundTasks(lead, NOW, withAgent, { onScreenShellCount: 6 })

    expect(tasks.running.filter((task) => task.kind === 'shell').map((task) => task.id)).toEqual(['bhcfbe9vf', 'bbgtz4rfz'])
  })

  it("keeps a shell the footer's count retired finished while a dialog hides the footer", () => {
    // Hand-started tab, no beacon: at 00:19:40 the footer said one shell for
    // two named ones, so the older was retired. A question then covered the
    // footer, the reading went null, and the retired shell came back.
    const readAt = Date.parse('2026-09-26T00:19:40.000Z')
    const later = readAt + 60_000
    const reading = deriveBackgroundTasks(lead, readAt + 1_000, { state: 'working' }, { onScreenShellCount: 1 })
    const hidden = deriveBackgroundTasks(lead, later, { state: 'working' }, {
      onScreenShellCount: null,
      heldOnScreenShellCount: { count: 1, at: readAt }
    })

    expect(reading.running.map((task) => task.id)).toEqual(['bbgtz4rfz'])
    expect(hidden.running.map((task) => task.id)).toEqual(['bbgtz4rfz'])
  })

  it('pads no nameless "Background shell" row for shells the footer counts and nothing names, with or without an agent', () => {
    // 2026-09-14 to 2026-10-11 the phone padded the lead's list up to the
    // footer ("· 4 shells", none in the beacon's tail). In session 0954729d
    // (2026-10-11) the four were timed-out commands that finished subagents had
    // left running: the padded row was none of the lead's, and the Claude app
    // listed nothing running. A footer count now only caps.
    const alone = deriveBackgroundTasks([], NOW, { state: 'working', subagents: [] }, { onScreenShellCount: 4 })
    const agentRuns = deriveBackgroundTasks([], NOW + 5_000, withAgent, { onScreenShellCount: 5 })
    const agentGone = deriveBackgroundTasks([], NOW + 10_000, { state: 'working', subagents: [] }, { onScreenShellCount: 4 })

    expect([alone, agentRuns, agentGone].map((tasks) => tasks.running.filter((task) => task.kind === 'shell').length)).toEqual([0, 0, 0])
  })

  it('does not let a held count retire a shell launched after it was read', () => {
    const readAt = Date.parse('2026-09-26T00:19:40.000Z')
    const newer = backgroundShellLaunch('b1q85ypx9', '2026-09-26T00:24:47.897Z', '2026-09-26T00:24:49.471Z')
    const tasks = deriveBackgroundTasks([...lead, ...newer], Date.parse('2026-09-26T00:25:00.000Z'), { state: 'working' }, {
      heldOnScreenShellCount: { count: 1, at: readAt }
    })

    expect(tasks.running.map((task) => task.id)).toEqual(['bbgtz4rfz', 'b1q85ypx9'])
  })
})
