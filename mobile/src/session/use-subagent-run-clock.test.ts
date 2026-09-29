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
import { RESUMED_AGENT_ID, RESUMED_AGENT_ROSTER_ROW, RESUMED_AGENT_TIMES, resumeRecords } from './fixtures/claude-resumed-agent-2.1.283'
import { advanceSubagentRunClock, resetSubagentRunClocksForTest } from './use-subagent-run-clock'

const NOW = Date.parse('2026-09-29T15:00:00Z')
const pane = { paneKey: 'pane-1', prompt: 'go', stateHistory: [{ state: 'done' as const, prompt: '', startedAt: NOW - 80 * 60_000 }] }
const agent = { id: 'a1', description: 'Sweep', agentType: 'general-purpose', state: 'working' as const, startedAt: NOW - 75 * 60_000 }
/** Orca's stand-in, built from the terminal title in place of the pane's hook
 *  row when the title changed after the row and they disagree, or the row is
 *  over 30 minutes old (Orca 1.4.216's title-only status;
 *  agent-status-stand-in.ts): the pane's key and state, no prompt, no
 *  history, no roster. */
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

  // What the clock's limits reach (the review of 7e632bbb): it times a roster
  // row only when the loaded window holds neither its launch nor the lead's
  // resume of it. A resume the clock missed, behind a stand-in read through
  // or while the chat read nothing, is timed from the lead's own SendMessage
  // while that is loaded (Claude Code 2.1.283's records), whatever the clock
  // kept; only once the window has moved past it does the kept start show.
  it('times a resumed subagent from the lead’s resume in the loaded window, whatever the clock kept', () => {
    const row = { ...RESUMED_AGENT_ROSTER_ROW, startedAt: Date.parse(RESUMED_AGENT_TIMES.resumed) }
    const kept = new Map([[RESUMED_AGENT_ID, Date.parse(RESUMED_AGENT_TIMES.launched)]])
    const now = Date.parse('2026-09-28T16:38:13.351Z')
    const time = (messages: ReturnType<typeof resumeRecords>) =>
      formatBackgroundTaskElapsed(
        deriveBackgroundTasks(messages, now, { state: 'working', subagents: [row] }, { subagentRuns: kept }).running.find((task) => task.id === RESUMED_AGENT_ID)?.elapsedMs ?? null
      )
    expect({ loaded: time(resumeRecords()), movedPast: time([]) }).toEqual({ loaded: '10m 0s', movedPast: '4h 19m' })
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
// "1h 15m". That holds while the nested claude runs; the lead's row after it
// is the limit at the end. The host rows are built by the vendored hook
// listener.
describe('a roster subagent’s run clock across a nested claude in the pane', () => {
  const LEAD = 'session-lead'
  const X = 'abe66e505fe909946'
  const paneKey = makePaneKey('tab-1', '44444444-4444-4444-8444-444444444444')
  const at = (clock: string) => Date.parse(`2026-09-29T${clock}Z`)

  function hostRows(): { first: AgentSubagentSnapshot[]; afterNested: AgentSubagentSnapshot[]; later: AgentSubagentSnapshot[]; stops: number } {
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
    const afterNested = event('09:59:30.000', { hook_event_name: 'PreToolUse', session_id: LEAD, agent_id: X, tool_name: 'Read' })
    const later = event('10:10:08.000', { hook_event_name: 'PreToolUse', session_id: LEAD, agent_id: X, tool_name: 'Grep' })
    return {
      first: (started?.payload.subagents ?? []) as AgentSubagentSnapshot[],
      afterNested: (afterNested?.payload.subagents ?? []) as AgentSubagentSnapshot[],
      later: (later?.payload.subagents ?? []) as AgentSubagentSnapshot[],
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
    expect(rows.later.find((row) => row.id === X)?.startedAt).toBe(at('09:59:30.000'))
  })

  it('keeps timing the subagent from the start the phone watched, not from its re-creation, while the nested claude runs', () => {
    const rows = hostRows()
    advanceSubagentRunClock(lead(rows.first), at('08:45:02.000'))
    const clock = advanceSubagentRunClock(lead(rows.afterNested), at('09:59:40.000'))
    expect(clock?.get(X)).toBe(at('08:45:00.000'))
    expect(shown(clock, rows.afterNested, at('10:00:00.000'))).toBe('1h 15m')
  })

  // The review of 7e632bbb (its finding 1): after the re-creation the host's
  // start stays 09:59:30 for the rest of the run while the clock keeps 08:45.
  // A later stand-in (a reconnect, a tab switch back) then took that same,
  // unmoved start for a resume, timed from the phone's now: "0s", the user's
  // symptom again. A start is new only against the last roster read.
  it('keeps timing it from the start the phone watched through a later stand-in, the host’s start unmoved since', () => {
    const rows = hostRows()
    advanceSubagentRunClock(lead(rows.first), at('08:45:02.000'))
    advanceSubagentRunClock(lead(rows.afterNested), at('09:59:40.000'))
    advanceSubagentRunClock({ paneKey, prompt: '', stateHistory: [] }, at('10:10:05.000'))
    const clock = advanceSubagentRunClock(lead(rows.later), at('10:10:10.000'))
    expect(shown(clock, rows.later, at('10:10:10.000'))).toBe('1h 25m')
  })

  // The review of 824b3fdf (R4-1): a subagent the phone first saw already
  // running has an unknown start, drawn as no time. A stand-in read as it
  // comes, then the nested claude's re-creation: a start the clock never knew
  // cannot have been ended, and timed from the re-creation it read "30s".
  it('keeps a start it never knew unknown across the re-creation, a stand-in read as it comes between', () => {
    const rows = hostRows()
    expect(advanceSubagentRunClock(lead(rows.first), at('09:30:00.000'))?.get(X)).toBeNull()
    advanceSubagentRunClock({ paneKey, prompt: '', stateHistory: [] }, at('09:58:50.000'))
    const clock = advanceSubagentRunClock(lead(rows.afterNested), at('09:59:30.100'))
    expect(clock?.get(X)).toBeNull()
    expect(shown(clock, rows.afterNested, at('10:00:00.000'))).toBeNull()
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
  // A limit, pinned (the review of 078a79b9, its finding 1): the above holds
  // while the nested claude runs. The lead's first event after it, the
  // PostToolUse of the Bash that ran it, takes the pane's session back, and
  // the listener deletes every row the replaced session held
  // (voidClaimsOfReplacedClaudeSession), the lead's running agent with them:
  // a lead row that lists none, which the phone cannot tell from the agent's
  // stop. Its next call re-creates it, and the run is timed from there. The
  // task memory drops the agent from the count on that row too (on main).
  it('times it from its next re-creation once the nested claude exits and the lead’s row lists none (a limit)', () => {
    const state = createHookListenerState()
    const event = (clock: string, payload: Record<string, unknown>) => {
      vi.setSystemTime(at(clock))
      return (normalizeHookPayload(state, 'claude', { paneKey, payload }, 'production')?.payload.subagents ?? []) as AgentSubagentSnapshot[]
    }
    event('08:44:50.000', { hook_event_name: 'UserPromptSubmit', session_id: LEAD, prompt: 'go' })
    const first = event('08:45:00.000', { hook_event_name: 'SubagentStart', session_id: LEAD, agent_id: X, agent_type: 'general-purpose' })
    const bash = event('09:58:55.000', { hook_event_name: 'PreToolUse', session_id: LEAD, tool_name: 'Bash', tool_input: { command: 'claude -p "second opinion"' } })
    event('09:59:00.000', { hook_event_name: 'SessionStart', session_id: 'session-nested', source: 'startup' })
    event('09:59:10.000', { hook_event_name: 'UserPromptSubmit', session_id: 'session-nested', prompt: 'second opinion' })
    const recreated = event('09:59:30.000', { hook_event_name: 'PreToolUse', session_id: LEAD, agent_id: X, tool_name: 'Read' })
    event('09:59:40.000', { hook_event_name: 'Stop', session_id: 'session-nested' })
    const back = event('09:59:41.000', { hook_event_name: 'PostToolUse', session_id: LEAD, tool_name: 'Bash' })
    const again = event('10:02:00.000', { hook_event_name: 'PreToolUse', session_id: LEAD, agent_id: X, tool_name: 'Grep' })
    expect(back).toEqual([])
    expect(again.find((row) => row.id === X)?.startedAt).toBe(at('10:02:00.000'))
    advanceSubagentRunClock(lead(first), at('08:45:02.000'))
    advanceSubagentRunClock(lead(bash), at('09:58:55.100'))
    expect(advanceSubagentRunClock(lead(recreated), at('09:59:30.100'))?.get(X)).toBe(at('08:45:00.000'))
    advanceSubagentRunClock(lead(back), at('09:59:41.100'))
    const clock = advanceSubagentRunClock(lead(again), at('10:02:00.100'))
    expect(shown(clock, again, at('10:02:30.000'))).toBe('30s')
  })
})
