import { describe, expect, it } from 'vitest'
import { parseCcrEvent, type CcrEvent } from './ccr-session-api'
import { deriveCcrLiveState } from './ccr-live-state'
import { claudeFooterStats } from './claude-working-footer-stats'
import { FOOTER_CLOCK_OFF, stepFooterClock } from './use-claude-footer-stats'
import { SESSION_A, event } from './fixtures/ccr-session-api-2026-10-14'

// 2026-10-16, the user's two screenshots of one moment on one Claude Code session, the lead
// waiting on an Agent call: the Claude app (com.anthropic.claude 1.261013.20) drew the footer's
// verb, "••• Noodling...", and Code UI drew its stats, "••• 47s · thinking some more…".
//
// The app draws stats only when `qq30.o` (qq30.java:353-460) returns some: thinking now, a span
// closed under 2 s ago, or a token count. Its "thinking now" is `su8.f7` (zr8 case 15:
// `gzy.c() != null` and no dialog/permission state), and `gzy.o`, behind `c()`, is set only by a
// `ThinkingTokensChanged` with its block open (`olv`, from a `system` `thinking_tokens` that moved
// the count, t5v.java:1058-1061) and cleared by `ThinkingBlockClosed` (`nlv`, a top-level assistant
// message after such tokens, t5v.java:846-848), or by the resets at a prompt, the result and an
// interrupt (t5v.L/q/s). Neither the prompt, nor a thinking-only message, nor the stream's own
// content blocks set it. Code UI inferred thinking from those, and a turn waiting on a tool after
// a thinking block read as thinking for as long as it waited.
//
// Event shapes: the envelope is `event()` (keys observed live 2026-10-14); `thinking_tokens` carries
// `estimated_tokens` / `estimated_tokens_delta` (the app's omt.java).

const T0 = Date.parse('2026-10-16T09:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

function withTime(raw: Record<string, unknown>, ms: number): CcrEvent {
  return parseCcrEvent({ ...raw, created_at: iso(ms) })!
}

const lead = { session_id: SESSION_A, parent_tool_use_id: null }
const prompt = (uuid: string, ms: number) =>
  withTime(event({ type: 'user', uuid, ...lead, message: { role: 'user', content: 'Port the Claude app live tool row' } }), ms)
const thought = (uuid: string, ms: number) =>
  withTime(event({ type: 'assistant', uuid, ...lead, message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: 'An agent can do this', signature: 'sig' }] } }), ms)
const narration = (uuid: string, ms: number) =>
  withTime(event({ type: 'assistant', uuid, ...lead, message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Starting an agent on it.' }] } }), ms)
const agentCall = (uuid: string, ms: number) =>
  withTime(
    event({
      type: 'assistant',
      uuid,
      ...lead,
      message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'toolu_agent', name: 'Agent', input: { description: 'Port Claude app live tool row', prompt: 'p' } }] }
    }),
    ms
  )
const agentAnswer = (uuid: string, ms: number) =>
  withTime(event({ type: 'user', uuid, ...lead, message: { role: 'user', content: [{ tool_use_id: 'toolu_agent', type: 'tool_result', content: 'Done.' }] } }), ms)
const tokens = (uuid: string, estimated: number, delta: number) =>
  parseCcrEvent(event({ type: 'system', subtype: 'thinking_tokens', uuid, session_id: SESSION_A, estimated_tokens: estimated, estimated_tokens_delta: delta }))!

const LIVE = { liveFrom: 0, connectionStatus: 'connected' }

/** The footer's line for these events at `now`: the stats, or null when it draws its verb. */
function footerAt(events: CcrEvent[], now: number) {
  const live = deriveCcrLiveState(events, LIVE)
  return claudeFooterStats({ turnStartedAt: live.turnStartedAt, thinking: live.thinking, thinkingTokens: live.thinkingTokens }, now)
}

describe('the footer while the lead waits on a tool (2026-10-16 screenshots)', () => {
  it('draws the verb, not "thinking some more…", while an Agent call made after a thinking block waits', () => {
    const events = [prompt('u1', T0), thought('a1', T0 + 2_000), agentCall('a3', T0 + 4_000)]
    expect(deriveCcrLiveState(events, LIVE).thinking).toBe(false)
    expect(footerAt(events, T0 + 47_000)).toBeNull()
  })

  // What made Code UI think: its `thinking` held true wherever the newest lead event was a
  // prompt (a typed one, or one Claude Code delivers to the lead while it waits) or a
  // thinking-only message, or the stream had last opened a thinking block. The app's needs a
  // thinking_tokens count.
  it('draws the verb, not "thinking some more…", 47 s on while a message reached the waiting lead', () => {
    const events = [prompt('u1', T0), agentCall('a1', T0 + 2_000), agentAnswer('u2', T0 + 3_000), prompt('u3', T0 + 4_000)]
    expect(deriveCcrLiveState(events, LIVE).working).toBe(true)
    expect(footerAt(events, T0 + 47_000)).toBeNull()
  })

  it('draws the verb right after the prompt, before any thinking tokens', () => {
    expect(deriveCcrLiveState([prompt('u1', T0)], LIVE).thinking).toBe(false)
    expect(footerAt([prompt('u1', T0)], T0 + 5_000)).toBeNull()
  })

  it('draws the verb while a thinking-only message is the newest and no tokens came', () => {
    expect(footerAt([prompt('u1', T0), thought('a1', T0 + 2_000)], T0 + 5_000)).toBeNull()
  })
})

describe('the footer while thinking tokens stream', () => {
  it('draws "Ns · N tokens · thinking…" while the block is open', () => {
    const events = [prompt('u1', T0), tokens('k1', 0, 400)]
    expect(deriveCcrLiveState(events, LIVE).thinking).toBe(true)
    expect(footerAt(events, T0 + 5_000)).toEqual({ stats: '5s · 400 tokens', status: 'thinking…' })
  })

  it('stops thinking when the assistant message lands, and keeps the turn\'s token figure', () => {
    const events = [prompt('u1', T0), tokens('k1', 0, 400), thought('a1', T0 + 4_000), agentCall('a2', T0 + 5_000)]
    const live = deriveCcrLiveState(events, LIVE)
    expect(live.thinking).toBe(false)
    // The app's `m` is cleared only by the resets (t5v.L at a prompt and the result, q, s), not by
    // the block closing: the figure stays, with no status.
    expect(live.thinkingTokens).toBe(400)
    expect(footerAt(events, T0 + 47_000)).toEqual({ stats: '47s · 400 tokens', status: null })
  })

  it('thinks again when tokens come after the tool\'s answer', () => {
    const events = [prompt('u1', T0), tokens('k1', 0, 400), agentCall('a1', T0 + 4_000), agentAnswer('u2', T0 + 30_000), tokens('k2', 0, 200)]
    expect(deriveCcrLiveState(events, LIVE).thinking).toBe(true)
    expect(deriveCcrLiveState(events, LIVE).thinkingTokens).toBe(600)
  })

  it('a token event that moves no count opens nothing', () => {
    expect(deriveCcrLiveState([prompt('u1', T0), tokens('k1', 0, 0)], LIVE).thinking).toBe(false)
  })

  it('a new prompt in the same turn starts the figure and the block over, as the app\'s reset at a prompt does', () => {
    const events = [prompt('u1', T0), tokens('k1', 0, 400), narration('a1', T0 + 3_000), prompt('u2', T0 + 4_000)]
    const live = deriveCcrLiveState(events, LIVE)
    expect(live.working).toBe(true)
    expect(live.thinking).toBe(false)
    expect(live.thinkingTokens).toBeNull()
  })

  it('a subagent\'s thinking tokens are not the lead\'s', () => {
    const sub = parseCcrEvent(event({ type: 'system', subtype: 'thinking_tokens', uuid: 'k9', session_id: SESSION_A, parent_tool_use_id: 'toolu_agent', estimated_tokens: 0, estimated_tokens_delta: 500 }))!
    const live = deriveCcrLiveState([prompt('u1', T0), agentCall('a1', T0 + 1_000), sub], LIVE)
    expect(live.thinking).toBe(false)
    expect(live.thinkingTokens).toBeNull()
  })
})

describe('"thought for" after the block closes', () => {
  it('draws "thought for Ns" under 2 s after the assistant message closed the block, then the stats alone', () => {
    const open = deriveCcrLiveState([prompt('u1', T0), tokens('k1', 0, 400)], LIVE)
    const closed = deriveCcrLiveState([prompt('u1', T0), tokens('k1', 0, 400), thought('a1', T0 + 8_000), agentCall('a2', T0 + 8_500)], LIVE)
    const input = (live: typeof open) => ({ turnStartedAt: live.turnStartedAt, thinking: live.thinking, thinkingTokens: live.thinkingTokens })
    let clock = stepFooterClock(FOOTER_CLOCK_OFF, input(open), T0 + 1_000)
    clock = stepFooterClock(clock, input(closed), T0 + 9_000)
    expect(claudeFooterStats(input(closed), T0 + 10_000, { lastThinking: clock.span.last })).toEqual({ stats: '10s · 400 tokens', status: 'thought for 8s' })
    expect(claudeFooterStats(input(closed), T0 + 11_000, { lastThinking: clock.span.last })).toEqual({ stats: '11s · 400 tokens', status: null })
  })
})
