// The run clock the tasks sheet times a roster subagent by (a subagent the
// loaded transcript never showed launching). How it counts is in
// mobile-background-tasks.test.ts, "a roster subagent's time".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeHookPayload } from '../../../src/shared/agent-hook-listener'
import { createHookListenerState } from '../../../src/shared/agent-hook-listener/listener-state'
import type { AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import { makePaneKey } from '../../../src/shared/stable-pane-id'
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

  // The same moved start with nothing between, a stand-in's shape or not:
  // what a nested claude leaves (below). The run the phone watched goes on.
  it('keeps the run it watched when the next status lists it with a later start and nothing hid the roster between', () => {
    advanceSubagentRunClock({ ...pane, subagents: [agent] }, NOW - 75 * 60_000 + 2_000)
    const recreated = { ...agent, startedAt: NOW - 30_000 }
    const clock = advanceSubagentRunClock({ ...pane, subagents: [recreated] }, NOW - 20_000)
    const tasks = deriveBackgroundTasks([], NOW, { state: 'working', subagents: [recreated] }, { subagentRuns: clock })
    expect(formatBackgroundTaskElapsed(tasks.running[0]?.elapsedMs ?? null)).toBe('1h 15m')
  })

  // Degenerate: a stand-in before the phone has any clock for the pane, and
  // a status with no pane at all.
  it('has no clock from a stand-in alone, or from a status with no pane', () => {
    expect(advanceSubagentRunClock(standIn, NOW)).toBeUndefined()
    expect(advanceSubagentRunClock({ subagents: [agent] }, NOW)).toBeUndefined()
  })
})

// The cross-branch review of fix/midturn-residuals and ad2253 (2026-09-29): a
// `claude -p` the lead runs from its Bash tool posts as the pane. Its
// SessionStart deletes the pane's roster (vendored claude-events.ts), and the
// lead's subagent, running all along, is re-created by its next tool call
// with a new start (claude-subagent-roster.ts, `startedAt: now`), with no
// SubagentStop. The phone withholds the nested run's statuses from the task
// readers, so the next status the clock sees is the lead's, the start moved.
// Timed from the re-creation, the sheet read "30s" beside the desk's
// "1h 15m". The host rows here are built by the vendored hook listener.
describe('a roster subagent’s run clock across a nested claude in the pane', () => {
  const LEAD = 'session-lead'
  const X = 'abe66e505fe909946'
  const paneKey = makePaneKey('tab-1', '44444444-4444-4444-8444-444444444444')
  const at = (clock: string) => Date.parse(`2026-09-29T${clock}Z`)

  function hostRows(): { first: AgentSubagentSnapshot[]; afterNested: AgentSubagentSnapshot[]; stops: number } {
    const state = createHookListenerState()
    let stops = 0
    const event = (clock: string, payload: Record<string, unknown>) => {
      vi.setSystemTime(at(clock))
      stops += payload.hook_event_name === 'SubagentStop' ? 1 : 0
      return normalizeHookPayload(state, 'claude', { paneKey, payload }, 'production')
    }
    event('08:44:50.000', { hook_event_name: 'UserPromptSubmit', session_id: LEAD, prompt: 'go' })
    const started = event('08:45:00.000', { hook_event_name: 'SubagentStart', session_id: LEAD, agent_id: X, agent_type: 'general-purpose' })
    event('09:59:00.000', { hook_event_name: 'SessionStart', session_id: 'session-nested', source: 'startup' })
    event('09:59:10.000', { hook_event_name: 'UserPromptSubmit', session_id: 'session-nested', prompt: 'nested' })
    const later = event('09:59:30.000', { hook_event_name: 'PreToolUse', session_id: LEAD, agent_id: X, tool_name: 'Read' })
    return {
      first: (started?.payload.subagents ?? []) as AgentSubagentSnapshot[],
      afterNested: (later?.payload.subagents ?? []) as AgentSubagentSnapshot[],
      stops
    }
  }
  const lead = (subagents: AgentSubagentSnapshot[]) => ({
    paneKey,
    prompt: 'go',
    stateHistory: [{ state: 'done' as const, prompt: '', startedAt: at('08:00:00.000') }],
    subagents
  })
  const shown = (clock: ReturnType<typeof advanceSubagentRunClock>, rows: AgentSubagentSnapshot[], now: number) =>
    formatBackgroundTaskElapsed(
      deriveBackgroundTasks([], now, { state: 'working', subagents: rows }, { subagentRuns: clock }).running.find((task) => task.id === X)?.elapsedMs ?? null
    )

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    resetSubagentRunClocksForTest()
  })
  afterEach(() => vi.useRealTimers())

  it('re-creates the row with a later start and no stop, as Orca’s listener does', () => {
    const rows = hostRows()
    expect(rows.stops).toBe(0)
    expect(rows.first.find((row) => row.id === X)?.startedAt).toBe(at('08:45:00.000'))
    expect(rows.afterNested.find((row) => row.id === X)?.startedAt).toBe(at('09:59:30.000'))
  })

  it('keeps timing the subagent from the start the phone watched, not from its re-creation', () => {
    const rows = hostRows()
    advanceSubagentRunClock(lead(rows.first), at('08:45:02.000'))
    const clock = advanceSubagentRunClock(lead(rows.afterNested), at('09:59:40.000'))
    expect(clock?.get(X)).toBe(at('08:45:00.000'))
    expect(shown(clock, rows.afterNested, at('10:00:00.000'))).toBe('1h 15m')
  })

  // The cost, shared with the task memory (163ceb78): a stand-in between the
  // re-creation and the next hook row reads as a stop the phone did not see,
  // and the run is timed from the re-creation.
  it('times it from the re-creation when a stand-in hid the roster between (a limit)', () => {
    const rows = hostRows()
    advanceSubagentRunClock(lead(rows.first), at('08:45:02.000'))
    advanceSubagentRunClock({ paneKey, prompt: '', stateHistory: [] }, at('09:59:20.000'))
    const clock = advanceSubagentRunClock(lead(rows.afterNested), at('09:59:40.000'))
    expect(shown(clock, rows.afterNested, at('10:00:00.000'))).toBe('30s')
  })
})
