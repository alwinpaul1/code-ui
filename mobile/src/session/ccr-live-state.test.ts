import { describe, expect, it } from 'vitest'
import { parseCcrEvent, type CcrEvent } from './ccr-session-api'
import { deriveCcrLiveState, readCcrRateLimit } from './ccr-live-state'
import { SESSION_A, event } from './fixtures/ccr-session-api-2026-10-14'

// Event shapes: the envelope is `event()` (the keys observed live 2026-10-14). Payloads:
//  - `result`: the keys observed live on 2026-10-15 (scratchpad/probe/p7-result.json `resultKeys`);
//  - `system` `background_tasks_changed`: observed live 2026-10-15 (p4-result.json, `tasks: []`);
//    a task entry's `task_id` / `task_type` are what the Claude app reads (qhu.java:2296-2335);
//  - `rate_limit_event`: the app's `SdkRateLimitEvent` (klt.java) and `RateLimitInfo` (mlt.java);
//  - `system` `status` and `thinking_tokens`: the app's `SdkSystemMessage` fields (omt.java).

const at = (iso: string) => ({ created_at: iso })

function withTime(raw: Record<string, unknown>, iso: string): CcrEvent {
  return parseCcrEvent({ ...raw, ...at(iso) })!
}

const prompt = (uuid: string, words: string, iso: string) =>
  withTime(event({ type: 'user', uuid, session_id: SESSION_A, parent_tool_use_id: null, message: { role: 'user', content: words } }), iso)
const reply = (uuid: string, words: string, iso: string) =>
  withTime(event({ type: 'assistant', uuid, session_id: SESSION_A, parent_tool_use_id: null, message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: words }] } }), iso)
const thought = (uuid: string, iso: string) =>
  withTime(event({ type: 'assistant', uuid, session_id: SESSION_A, parent_tool_use_id: null, message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: 'Looking at the parser', signature: 'sig' }] } }), iso)
const toolCall = (uuid: string, id: string, iso: string) =>
  withTime(event({ type: 'assistant', uuid, session_id: SESSION_A, parent_tool_use_id: null, message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' } }] } }), iso)
const toolResult = (uuid: string, id: string, iso: string) =>
  withTime(event({ type: 'user', uuid, session_id: SESSION_A, parent_tool_use_id: null, message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: 'a.ts' }] } }), iso)
const result = (uuid: string, iso: string) =>
  withTime(
    event({
      type: 'result',
      subtype: 'success',
      uuid,
      session_id: SESSION_A,
      duration_api_ms: 9000,
      duration_ms: 12000,
      is_error: false,
      modelUsage: {},
      num_turns: 2,
      permission_denials: [],
      result: 'Done.',
      stop_reason: 'end_turn',
      terminal_reason: null,
      total_cost_usd: 0.04,
      usage: {}
    }),
    iso
  )
const interrupted = (uuid: string, iso: string) =>
  withTime(event({ type: 'user', uuid, session_id: SESSION_A, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } }), iso)
const tasksChanged = (uuid: string, tasks: unknown[], parent: string | null = null) =>
  parseCcrEvent(event({ session_id: SESSION_A, subtype: 'background_tasks_changed', tasks, type: 'system', uuid, ...(parent ? { parent_tool_use_id: parent } : {}) }))!
const rateLimit = (uuid: string, info: Record<string, unknown>) =>
  parseCcrEvent(event({ type: 'rate_limit_event', uuid, session_id: SESSION_A, parent_tool_use_id: null, rate_limit_info: info }))!
const thinkingTokens = (uuid: string, estimated: number, delta: number) =>
  parseCcrEvent(event({ type: 'system', subtype: 'thinking_tokens', uuid, session_id: SESSION_A, estimated_tokens: estimated, estimated_tokens_delta: delta }))!
const status = (uuid: string, value: string | null) => parseCcrEvent(event({ type: 'system', subtype: 'status', uuid, session_id: SESSION_A, status: value }))!

const LIVE = { liveFrom: 0, connectionStatus: 'connected' }
const T0 = '2026-10-15T12:29:33Z'

describe('a Claude tab’s live state from Anthropic’s events', () => {
  it('a prompt with the reply still coming is a working turn, started at the prompt', () => {
    const live = deriveCcrLiveState([prompt('u1', 'Fix the parser', T0), toolCall('a1', 'toolu_1', '2026-10-15T12:29:40Z')], LIVE)
    expect(live.working).toBe(true)
    expect(live.turnStartedAt).toBe(Date.parse(T0))
  })

  it('a result ends the turn: idle', () => {
    const live = deriveCcrLiveState([prompt('u1', 'Fix the parser', T0), reply('a1', 'Fixed.', T0), result('r1', T0)], LIVE)
    expect(live).toMatchObject({ working: false, turnStartedAt: null, thinking: false })
  })

  it('the interrupt marker ends the turn too', () => {
    const live = deriveCcrLiveState([prompt('u1', 'Fix the parser', T0), toolCall('a1', 'toolu_1', T0), interrupted('u2', T0)], LIVE)
    expect(live.working).toBe(false)
  })

  it('a new prompt after a result opens the next turn at its own time', () => {
    const later = '2026-10-15T12:30:10Z'
    const live = deriveCcrLiveState([prompt('u1', 'one', T0), result('r1', T0), prompt('u2', 'two', later)], LIVE)
    expect(live).toMatchObject({ working: true, turnStartedAt: Date.parse(later) })
  })

  it('a subagent’s own messages after the result do not reopen the lead’s turn', () => {
    const sub = withTime(event({ type: 'assistant', uuid: 's1', session_id: SESSION_A, parent_tool_use_id: 'toolu_9', message: { role: 'assistant', content: [{ type: 'text', text: 'sub' }] } }), T0)
    expect(deriveCcrLiveState([prompt('u1', 'one', T0), result('r1', T0), sub], LIVE).working).toBe(false)
  })

  it('events read only from the phone’s kept copy claim no turn: it keeps rows, never the result', () => {
    // The kept copy (sequence up to the last event here) held a prompt and its reply but no result.
    const kept = [prompt('u1', 'one', T0), reply('a1', 'done', T0)]
    const liveFrom = kept[kept.length - 1]!.sequenceNum!
    expect(deriveCcrLiveState(kept, { ...LIVE, liveFrom }).working).toBe(false)
    // What Anthropic then streams decides: a new turn's event opens one.
    const streamed = toolCall('a2', 'toolu_2', '2026-10-15T12:30:00Z')
    expect(deriveCcrLiveState([...kept, streamed], { ...LIVE, liveFrom })).toMatchObject({ working: true, turnStartedAt: Date.parse('2026-10-15T12:30:00Z') })
  })

  it('a session Anthropic calls disconnected is not working (its Claude Code is not attached)', () => {
    const live = deriveCcrLiveState([prompt('u1', 'one', T0)], { ...LIVE, connectionStatus: 'disconnected' })
    expect(live).toMatchObject({ working: false, thinking: false, turnStartedAt: null })
  })

  // The degenerate sizes: nothing at all, and one event.
  it('no events: idle, no count, no limit', () => {
    expect(deriveCcrLiveState([], LIVE)).toEqual({ working: false, turnStartedAt: null, thinking: false, thinkingTokens: null, runningTasks: null, compacting: false, rateLimit: null })
  })
})

describe('running tasks', () => {
  it('counts the tasks of the newest background_tasks_changed', () => {
    const events = [
      tasksChanged('t1', [{ task_id: 'b7c1', task_type: 'local_bash' }]),
      tasksChanged('t2', [{ task_id: 'b7c1', task_type: 'local_bash' }, { task_id: 'a93f', task_type: 'local_agent' }])
    ]
    expect(deriveCcrLiveState(events, LIVE).runningTasks).toBe(2)
  })

  it('the observed empty list is zero, and an entry with a blank id is not a task', () => {
    expect(deriveCcrLiveState([tasksChanged('t1', [])], LIVE).runningTasks).toBe(0)
    expect(deriveCcrLiveState([tasksChanged('t1', [{ task_id: ' ' }, { task_type: 'local_bash' }])], LIVE).runningTasks).toBe(0)
  })

  it('a subagent’s own task list is not the session’s', () => {
    const events = [tasksChanged('t1', [{ task_id: 'b1' }, { task_id: 'b2' }]), tasksChanged('t2', [], 'toolu_9')]
    expect(deriveCcrLiveState(events, LIVE).runningTasks).toBe(2)
  })

  it('a list that is not a list is refused: the count stays unknown, not zero', () => {
    expect(deriveCcrLiveState([tasksChanged('t1', 'two' as unknown as unknown[])], LIVE).runningTasks).toBeNull()
  })
})

// The Claude app's thinking is `su8.f7`: a thinking_tokens moved the count since the last top-level
// assistant message (1.261013.20, ccr-live-state.ts has the lines). Until 2026-10-16 the prompt, a
// thinking-only message and the stream's thinking block made it think too, which the app's never
// do (claude-footer-thinking-from-events.test.ts has the user's case).
describe('thinking', () => {
  it('is not the prompt, nor a thinking-only message, with no tokens', () => {
    expect(deriveCcrLiveState([prompt('u1', 'one', T0)], LIVE).thinking).toBe(false)
    expect(deriveCcrLiveState([prompt('u1', 'one', T0), toolCall('a1', 'toolu_1', T0), toolResult('u2', 'toolu_1', T0), thought('a2', T0)], LIVE).thinking).toBe(false)
  })

  it('opens with a thinking_tokens count and closes with the next assistant message, of any kind', () => {
    const opened = [prompt('u1', 'one', T0), thinkingTokens('k1', 0, 400)]
    expect(deriveCcrLiveState(opened, LIVE).thinking).toBe(true)
    expect(deriveCcrLiveState([...opened, thought('a1', T0)], LIVE).thinking).toBe(false)
    expect(deriveCcrLiveState([...opened, reply('a1', 'Looking', T0)], LIVE).thinking).toBe(false)
    expect(deriveCcrLiveState([...opened, toolCall('a1', 'toolu_1', T0)], LIVE).thinking).toBe(false)
  })

  it('a tool result does not close it: only an assistant message does', () => {
    const events = [prompt('u1', 'one', T0), toolCall('a1', 'toolu_1', T0), thinkingTokens('k1', 0, 400), toolResult('u2', 'toolu_1', T0)]
    expect(deriveCcrLiveState(events, LIVE).thinking).toBe(true)
  })

  it('idle is never thinking, whatever the tokens said last', () => {
    expect(deriveCcrLiveState([prompt('u1', 'one', T0), thinkingTokens('k1', 0, 400), result('r1', T0)], LIVE).thinking).toBe(false)
  })

  it('thinking tokens add up within a block and across the turn, as the app’s j8y does', () => {
    const events = [prompt('u1', 'one', T0), thinkingTokens('k1', 0, 400), thinkingTokens('k2', 0, 300), thought('a1', T0), thinkingTokens('k3', 900, 100)]
    // 700 committed by the assistant message, then the next block's estimate 900 beats its delta.
    expect(deriveCcrLiveState(events, LIVE).thinkingTokens).toBe(1600)
  })

  it('a turn with no thinking_tokens has no token figure', () => {
    expect(deriveCcrLiveState([prompt('u1', 'one', T0)], LIVE).thinkingTokens).toBeNull()
  })

  it('reads compacting from system status', () => {
    expect(deriveCcrLiveState([prompt('u1', 'one', T0), status('s1', 'compacting')], LIVE).compacting).toBe(true)
    expect(deriveCcrLiveState([prompt('u1', 'one', T0), status('s1', 'compacting'), status('s2', null)], LIVE).compacting).toBe(false)
  })
})

describe('the limit state', () => {
  it('reads the app’s three states', () => {
    const reset = 1_792_000_000
    expect(readCcrRateLimit({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', rateLimitType: 'five_hour', resetsAt: reset, utilization: 0.91 } })).toEqual({
      kind: 'approaching',
      resetsAt: reset,
      rateLimitType: 'five_hour',
      isUsingOverage: false,
      utilization: 0.91,
      overageStatus: null
    })
    expect(readCcrRateLimit({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: reset, isUsingOverage: true } })).toMatchObject({ kind: 'reached', isUsingOverage: true })
    expect(readCcrRateLimit({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } })).toMatchObject({ kind: 'clear' })
  })

  it('a warning with no reset time is not drawn, as in the app', () => {
    expect(readCcrRateLimit({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } })).toMatchObject({ kind: 'clear' })
  })

  it('refuses a status it does not know, and a missing info', () => {
    expect(readCcrRateLimit({ type: 'rate_limit_event', rate_limit_info: { status: 'throttled' } })).toBeNull()
    expect(readCcrRateLimit({ type: 'rate_limit_event' })).toBeNull()
  })

  it('the newest readable event is the state; an unreadable one does not clear it', () => {
    const events = [rateLimit('r1', { status: 'allowed_warning', resetsAt: 1_792_000_000 }), rateLimit('r2', { status: 'mystery' })]
    expect(deriveCcrLiveState(events, LIVE).rateLimit).toMatchObject({ kind: 'approaching' })
  })
})
