// The run clock the tasks sheet times a roster subagent by (a subagent the
// loaded transcript never showed launching). How it counts is in
// mobile-background-tasks.test.ts, "a roster subagent's time".
import { beforeEach, describe, expect, it } from 'vitest'
import { deriveBackgroundTasks } from './mobile-background-tasks'
import { formatBackgroundTaskElapsed } from './mobile-background-task-labels'
import { advanceSubagentRunClock, resetSubagentRunClocksForTest } from './use-subagent-run-clock'

const NOW = Date.parse('2026-09-29T15:00:00Z')
const pane = { paneKey: 'pane-1', prompt: 'go', stateHistory: [{ state: 'done' as const, prompt: '', startedAt: NOW - 80 * 60_000 }] }
const agent = { id: 'a1', description: 'Sweep', agentType: 'general-purpose', state: 'working' as const, startedAt: NOW - 75 * 60_000 }
/** Orca's stand-in, built from the terminal title when its hook row is stale
 *  (Orca 1.4.216's title-only status): the pane's key and state, no prompt,
 *  no history, no roster. */
const standIn = { paneKey: 'pane-1', prompt: '', stateHistory: [] }

describe('a roster subagent’s run clock', () => {
  beforeEach(() => resetSubagentRunClocksForTest())

  // 2026-09-29, the user with screenshots: the desk said a subagent had run
  // for 1h 15m, the phone said seconds. Orca stands in its title-built status
  // over a long tool call, and read as a roster it emptied the pane's clock:
  // the next real status brought every subagent back as just started.
  it('keeps counting a run through Orca’s stand-in, which carries no roster', () => {
    advanceSubagentRunClock({ ...pane, subagents: [agent] }, NOW - 75 * 60_000 + 2_000)
    advanceSubagentRunClock(standIn, NOW - 10_000)
    const clock = advanceSubagentRunClock({ ...pane, subagents: [agent] }, NOW - 5_000)
    const tasks = deriveBackgroundTasks([], NOW, { state: 'working', subagents: [agent] }, { subagentRuns: clock })
    expect(formatBackgroundTaskElapsed(tasks.running[0]?.elapsedMs ?? null)).toBe('1h 15m')
  })

  // A real status with no roster is the host saying none is tracked: the
  // runs end, and one that shows up again starts over. So does a session
  // boundary, which says the pane was reset.
  it('still ends every run on a real status that tracks none, and on a session boundary', () => {
    advanceSubagentRunClock({ ...pane, subagents: [agent] }, NOW - 75 * 60_000 + 2_000)
    expect(advanceSubagentRunClock({ ...pane }, NOW - 10_000)?.size).toBe(0)
    expect(advanceSubagentRunClock({ ...pane, subagents: [agent] }, NOW - 5_000)?.get('a1')).toBe(NOW - 5_000)
    expect(advanceSubagentRunClock({ ...standIn, sessionBoundary: true }, NOW - 4_000)?.size).toBe(0)
  })

  // The review of b75a42e6 (K1): the lead resumes a subagent by SendMessage
  // with the same agent id, and Orca gives its row a new start because the
  // row had left. On a host whose real statuses carry no prompt and no
  // history, the status that said none was tracked has the stand-in's shape,
  // so the clock kept the first run, and the resumed one read "1h 0m".
  it('times a resumed subagent from its resume, not from its first run', () => {
    const bare = { paneKey: 'pane-1', prompt: '', stateHistory: [] }
    const firstRun = { ...agent, startedAt: NOW - 60 * 60_000 }
    advanceSubagentRunClock({ ...bare, subagents: [firstRun] }, NOW - 60 * 60_000 + 2_000)
    advanceSubagentRunClock({ ...bare }, NOW - 10 * 60_000)
    const resumed = { ...firstRun, startedAt: NOW - 20_000 }
    const clock = advanceSubagentRunClock({ ...bare, subagents: [resumed] }, NOW - 15_000)
    const tasks = deriveBackgroundTasks([], NOW, { state: 'working', subagents: [resumed] }, { subagentRuns: clock })
    expect(formatBackgroundTaskElapsed(tasks.running[0]?.elapsedMs ?? null)).toBe('20s')
  })

  // Degenerate: a stand-in before the phone has any clock for the pane, and
  // a status with no pane at all.
  it('has no clock from a stand-in alone, or from a status with no pane', () => {
    expect(advanceSubagentRunClock(standIn, NOW)).toBeUndefined()
    expect(advanceSubagentRunClock({ subagents: [agent] }, NOW)).toBeUndefined()
  })
})
