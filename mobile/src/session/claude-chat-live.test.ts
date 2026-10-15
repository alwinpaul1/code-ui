import { describe, expect, it } from 'vitest'
import { CCR_IDLE_LIVE_STATE, type CcrLiveState } from './ccr-live-state'
import { claudeChatHeaderConnection, claudeChatLive } from './claude-chat-live'

// Which source drives a Claude tab's chat: the relay, or Anthropic's stream. The evidence:
// 2026-10-15 12:29:33-12:31:10 the relay to the Mac failed (relay_outer_4408, then 4404 dials) and
// Code UI's tab said "Disconnected" with a bare "2 running tasks", while the Claude app on the same
// session said "Generating… · 2 running tasks".

const START = Date.parse('2026-10-15T12:29:33Z')
const working: CcrLiveState = { ...CCR_IDLE_LIVE_STATE, working: true, turnStartedAt: START, thinking: true, runningTasks: 2 }

describe('the chat’s live source', () => {
  it('relay down, Anthropic live: Anthropic drives working, the count and the header', () => {
    const live = claudeChatLive({ live: working, linkPhase: 'live', connectionStatus: null, relayConnected: false })
    expect(live).toMatchObject({ working: true, runningCount: 2, sessionConnection: 'connected', linkLive: true })
    expect(live?.footer).toEqual({ turnStartedAt: START, thinking: true, thinkingTokens: null })
  })

  it('relay down, Anthropic says the turn ended: idle, whatever the relay last said', () => {
    const live = claudeChatLive({ live: { ...CCR_IDLE_LIVE_STATE, runningTasks: 0 }, linkPhase: 'live', connectionStatus: 'connected', relayConnected: false })
    expect(live).toMatchObject({ working: false, runningCount: 0, footer: null, sessionConnection: 'connected' })
  })

  it('relay up: today’s sources keep working and the count; Anthropic adds only the stats', () => {
    const live = claudeChatLive({ live: working, linkPhase: 'live', connectionStatus: 'connected', relayConnected: true })
    expect(live).toMatchObject({ working: null, runningCount: null, sessionConnection: null })
    expect(live?.footer).not.toBeNull()
  })

  it('Anthropic’s stream not live (reconnecting, lost): nothing is overridden and no stats are drawn', () => {
    for (const phase of ['reconnecting', 'lost', 'error', 'loading'] as const) {
      expect(claudeChatLive({ live: working, linkPhase: phase, connectionStatus: 'connected', relayConnected: false })).toMatchObject({
        working: null,
        runningCount: null,
        sessionConnection: null,
        footer: null,
        linkLive: false
      })
    }
  })

  it('an unknown count stays the relay’s, even with Anthropic driving', () => {
    const live = claudeChatLive({ live: { ...working, runningTasks: null }, linkPhase: 'live', connectionStatus: null, relayConnected: false })
    expect(live?.runningCount).toBeNull()
  })

  it('the session’s own connection_status disconnected is the header’s word, as in the app', () => {
    const live = claudeChatLive({ live: CCR_IDLE_LIVE_STATE, linkPhase: 'live', connectionStatus: 'disconnected', relayConnected: false })
    expect(live?.sessionConnection).toBe('disconnected')
    expect(claudeChatHeaderConnection({ chatShown: true, live })).toEqual({ label: 'Disconnected', dot: 'disconnected' })
  })

  it('no status and no turn: the header keeps the relay’s label rather than guess', () => {
    const live = claudeChatLive({ live: CCR_IDLE_LIVE_STATE, linkPhase: 'live', connectionStatus: null, relayConnected: false })
    expect(live?.sessionConnection).toBeNull()
    expect(claudeChatHeaderConnection({ chatShown: true, live })).toBeNull()
  })

  it('the header says Connected for a live session only while the chat is shown: the terminal keeps the relay’s state', () => {
    const live = claudeChatLive({ live: working, linkPhase: 'live', connectionStatus: 'connected', relayConnected: false })
    expect(claudeChatHeaderConnection({ chatShown: true, live })).toEqual({ label: 'Connected', dot: 'connected' })
    expect(claudeChatHeaderConnection({ chatShown: false, live })).toBeNull()
  })

  it('an unmatched tab has no live state', () => {
    expect(claudeChatLive({ live: null, linkPhase: null, connectionStatus: null, relayConnected: false })).toBeNull()
    expect(claudeChatHeaderConnection({ chatShown: true, live: null })).toBeNull()
  })

  it('hands the newest limit state on for the banner', () => {
    const rateLimit = { kind: 'approaching' as const, resetsAt: 1_792_000_000, rateLimitType: 'five_hour', isUsingOverage: false, utilization: 0.9, overageStatus: null }
    expect(claudeChatLive({ live: { ...working, rateLimit }, linkPhase: 'live', connectionStatus: null, relayConnected: true })?.rateLimit).toEqual(rateLimit)
  })
})
