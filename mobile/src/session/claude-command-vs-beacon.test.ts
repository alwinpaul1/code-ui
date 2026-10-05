import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../transport/client-context-connection-metrics', () => ({ useLastConnectedAt: () => 1 }))

import { consumeAgentHudBeacons, resetAgentHudBeacons } from './agent-hud-beacon'
import { encodeAgentHudChannelFrame } from './agent-hud-channel'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { resetSessionCommandPairCacheForTests, sessionCommandPair, type SessionCommandPair } from './claude-session-command-pair'
import { claudeReportedOverLive, commandOverBeacon, type ClaudeModelFallback } from './claude-transcript-model'
import { clearPendingModelPicksForTests } from './mobile-native-chat-model-report-authority'
import { resetClaudeTranscriptModelPicksForTests, useClaudeTranscriptModel } from './use-claude-transcript-model'

// The user's rule (2026-10-05): "when the user switches mid-session it must
// change automatically, even after switching to another project or exiting the
// app". The beacon is a stream event: frames written while the phone was away
// are lost, and what the phone holds is the last one it heard.
//
// A command outranks the beacon only when the PHONE first saw its row after it
// last heard the beacon: both are the phone's own clock. The host's row time
// is never compared with the phone's clock (review N2, 2026-10-05: with the
// phone an hour behind, an old /effort outranked a newer beacon), and the
// beacon's last ARRIVAL counts, not its last change (review N3: an unchanged
// beacon repeats every 5 s and kept its first stamp).

const SID = '3f0c1d52-8a4e-4a39-9d52-0b6f2f7a1c11'
const row = (role: 'user' | 'assistant', body: string, timestamp: number): NativeChatMessage => ({
  id: `m${timestamp}${role}`,
  role,
  blocks: [{ type: 'text', text: body }],
  timestamp,
  source: 'transcript'
})
const ran = (name: string, body: string, at: number): NativeChatMessage[] => [
  row('user', `<command-name>/${name}</command-name>\n<command-args></command-args>`, at),
  row('user', `<local-command-stdout>${body}</local-command-stdout>`, at)
]
const pairOf = (rows: NativeChatMessage[], seenAt: number, boundModel: string | null = null): SessionCommandPair => ({
  ...sessionCommandPair(rows)!,
  seenAt,
  boundModel
})
const HOUR = 3_600_000

describe('commandOverBeacon', () => {
  const effortLow = (at: number, seenAt: number, bound: string | null = 'claude-opus-5-5') =>
    pairOf(ran('effort', 'Set effort level to low (this session only): Quick', at), seenAt, bound)

  it('a command first seen after the last time the beacon was heard outranks it', () => {
    expect(commandOverBeacon(effortLow(5_000, 9_000), 'claude-opus-5-5', 1_000, 'high')).toMatchObject({ outranksLive: true, effort: 'low' })
  })

  it('a beacon heard after the command was first seen wins', () => {
    expect(commandOverBeacon(effortLow(5_000, 9_000), 'claude-opus-5-5', 9_500, 'high')).toEqual({ kind: 'none' })
  })

  it('N2: the host clock an hour ahead of the phone changes nothing, only the phone clock orders them', () => {
    // Row written at host 12:00 (phone 11:00), first seen at phone 11:00; the
    // beacon was heard at phone 11:30 and says Sonnet 5 / high (alt+p, no row).
    const cmd = effortLow(12 * HOUR, 11 * HOUR)
    expect(commandOverBeacon(cmd, 'claude-sonnet-5', 11.5 * HOUR, 'high')).toEqual({ kind: 'none' })
  })

  it('N3: a Kept-model row for the model already running never erases the effort the beacon states', () => {
    const kept = pairOf(ran('model', 'Kept model as `Opus 5.5`', 5_000), 9_000)
    expect(commandOverBeacon(kept, 'claude-opus-5-5', 1_000, 'xhigh')).toEqual({ kind: 'none' })
    const same = pairOf(ran('model', 'Set model to `Opus 5.5` for this session only', 5_000), 9_000)
    expect(commandOverBeacon(same, 'claude-opus-5-5', 1_000, 'xhigh')).toEqual({ kind: 'none' })
  })

  it('an /effort auto row states no level, so it never erases the beacon\u2019s', () => {
    const auto = pairOf(ran('effort', 'Effort level set to auto (this session only)', 5_000), 9_000, 'claude-opus-5-5')
    expect(commandOverBeacon(auto, 'claude-opus-5-5', 1_000, 'xhigh')).toEqual({ kind: 'none' })
  })

  it('a row that states the same effort adds nothing', () => {
    expect(commandOverBeacon(effortLow(5_000, 9_000), 'claude-opus-5-5', 1_000, 'low')).toEqual({ kind: 'none' })
  })

  it('a different model outranks, with the effort its output stated', () => {
    const cmd = pairOf(ran('model', 'Set model to `Fable 5.1` for this session only with `high` effort', 5_000), 9_000)
    expect(commandOverBeacon(cmd, 'claude-opus-5-5', 1_000, 'xhigh')).toMatchObject({
      outranksLive: true,
      model: { model: 'claude-fable-5-1' },
      effort: 'high'
    })
  })

  it('an /effort read under another model does not apply to the one the beacon names', () => {
    expect(commandOverBeacon(effortLow(5_000, 9_000, 'claude-opus-5-5'), 'claude-sonnet-5', 1_000, 'high')).toEqual({ kind: 'none' })
  })

  it('nothing was ever heard, or nothing is live: no override', () => {
    expect(commandOverBeacon(effortLow(5_000, 9_000), 'claude-opus-5-5', null, 'high')).toEqual({ kind: 'none' })
    expect(commandOverBeacon(effortLow(5_000, 9_000), null, 1_000, null)).toEqual({ kind: 'none' })
    expect(commandOverBeacon(null, 'claude-opus-5-5', 1_000, 'high')).toEqual({ kind: 'none' })
  })
})

describe('laying a newer command over the live pair', () => {
  const live = { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'high', source: 'live' as const }
  it('replaces model, label and effort together', () => {
    expect(
      claudeReportedOverLive(live, { kind: 'transcript', model: { model: 'claude-fable-5-1', label: 'Fable 5.1' }, effort: null, outranksLive: true })
    ).toEqual({ model: 'claude-fable-5-1', label: 'Fable 5.1', effort: null, source: 'live' })
  })
  it('keeps the live name when the command named only an effort', () => {
    expect(
      claudeReportedOverLive(live, { kind: 'transcript', model: { model: 'claude-opus-5-5', label: '' }, effort: 'low', outranksLive: true })
    ).toEqual({ model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'low', source: 'live' })
  })
  it('leaves the live pair as it is for an ordinary fallback', () => {
    expect(claudeReportedOverLive(live, { kind: 'none' })).toBe(live)
    expect(claudeReportedOverLive(live, { kind: 'transcript', model: { model: 'x', label: 'x' } })).toBe(live)
  })
})

describe('the hook: a switch made while the phone was away, then a beacon', () => {
  let renderer: ReactTestRenderer | null = null
  let latest: ClaudeModelFallback | null = null
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    resetAgentHudBeacons()
    resetSessionCommandPairCacheForTests()
    resetClaudeTranscriptModelPicksForTests()
    clearPendingModelPicksForTests()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })
  const frame = (payload: string) => consumeAgentHudBeacons('t1', encodeAgentHudChannelFrame(payload))
  function Harness(p: { messages: NativeChatMessage[]; effort?: string | null }) {
    latest = useClaudeTranscriptModel({
      client: null,
      hostId: 'h',
      worktreeId: 'w',
      tabId: 't',
      sessionId: SID,
      enabled: true,
      connected: false,
      liveModel: 'claude-opus-5-5',
      liveEffort: p.effort ?? 'high',
      beacon: true,
      beaconHandle: 't1',
      beaconStoredAt: 10_000,
      agentWorking: false,
      messages: p.messages
    }).fallback
    return null
  }
  const render = (p: Parameters<typeof Harness>[0]) =>
    act(() => {
      if (renderer) {
        renderer.update(createElement(Harness, p))
      } else {
        renderer = create(createElement(Harness, p))
      }
    })

  it('shows the model typed on the desktop while away, then yields to the first beacon after it', () => {
    frame(`CUIHUD1 agent=claude hk=1 hb=5 sid=${SID} model=claude-opus-5-5 name=Opus%205.5 effort=high`)
    vi.setSystemTime(20_000)
    render({ messages: ran('model', 'Set model to `Fable 5.1` for this session only with `high` effort', 15_000) })
    expect(latest).toMatchObject({ outranksLive: true, model: { model: 'claude-fable-5-1' } })
    // An UNCHANGED beacon repeats: it is still the last word, so the override ends with no render of the page's own.
    vi.setSystemTime(25_000)
    act(() => {
      frame(`CUIHUD1 agent=claude hk=1 hb=5 sid=${SID} model=claude-opus-5-5 name=Opus%205.5 effort=high`)
    })
    expect(latest).toEqual({ kind: 'none' })
  })
})
