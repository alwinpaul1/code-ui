import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../transport/client-context-connection-metrics', () => ({ useLastConnectedAt: () => 1 }))

import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { resetSessionCommandPairCacheForTests } from './claude-session-command-pair'
import { claudeReportedOverLive, type ClaudeModelFallback } from './claude-transcript-model'
import { clearPendingModelPicksForTests } from './mobile-native-chat-model-report-authority'
import { resetClaudeTranscriptModelPicksForTests, useClaudeTranscriptModel } from './use-claude-transcript-model'

// The user's rule (2026-10-05): "when the user switches mid-session it must
// change automatically, even after switching to another project or exiting the
// app". The beacon is a stream event: frames written while the phone was away
// (another project, a killed app) are lost, and what the phone holds is the
// last one it saw. A model command row newer than that beacon is newer truth.

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

describe('a remembered beacon against a command typed after it', () => {
  let renderer: ReactTestRenderer | null = null
  let latest: ClaudeModelFallback | null = null
  beforeEach(() => {
    resetSessionCommandPairCacheForTests()
    resetClaudeTranscriptModelPicksForTests()
    clearPendingModelPicksForTests()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  function Harness(p: { liveModel: string | null; beaconReceivedAt: number | null; messages: NativeChatMessage[] }) {
    latest = useClaudeTranscriptModel({
      client: null,
      hostId: 'h',
      worktreeId: 'w',
      tabId: 't',
      sessionId: 's-1',
      enabled: true,
      connected: false,
      liveModel: p.liveModel,
      beacon: p.beaconReceivedAt !== null,
      beaconReceivedAt: p.beaconReceivedAt,
      agentWorking: false,
      messages: p.messages
    }).fallback
    return null
  }
  const render = (p: Parameters<typeof Harness>[0]) =>
    act(() => {
      renderer = create(createElement(Harness, p))
    })

  it('switch on the desktop while the phone was in another project: the model typed after the last beacon shows on return', () => {
    render({
      liveModel: 'claude-opus-5-5',
      beaconReceivedAt: 1_000,
      messages: ran('model', 'Set model to `Fable 5.1` for this session only with `high` effort', 5_000)
    })
    expect(latest).toMatchObject({ kind: 'transcript', outranksLive: true, model: { model: 'claude-fable-5-1' }, effort: 'high' })
  })

  it('the same for an /effort pick, which belongs to the model the beacon names', () => {
    render({
      liveModel: 'claude-opus-5-5',
      beaconReceivedAt: 1_000,
      messages: ran('effort', 'Set effort level to low (this session only): Quick', 5_000)
    })
    expect(latest).toMatchObject({ outranksLive: true, model: { model: 'claude-opus-5-5' }, effort: 'low' })
  })

  it('a beacon newer than the command wins: the live pair is never outranked by an older row', () => {
    render({
      liveModel: 'claude-opus-5-5',
      beaconReceivedAt: 9_000,
      messages: ran('model', 'Set model to `Fable 5.1` for this session only', 5_000)
    })
    expect(latest).toEqual({ kind: 'none' })
  })

  it('an /effort read under another model does not apply to the one the beacon names', () => {
    render({
      liveModel: 'claude-sonnet-5',
      beaconReceivedAt: 1_000,
      messages: ran('effort', 'Set effort level to low (this session only): Quick', 5_000)
    })
    // First seen under the live model: bound to it, so it applies.
    expect(latest).toMatchObject({ outranksLive: true, effort: 'low' })
  })

  it('no beacon time (a badge speaks, or none yet) leaves the live pair alone', () => {
    render({ liveModel: 'claude-opus-5-5', beaconReceivedAt: null, messages: ran('model', 'Set model to `Fable 5.1` for this session only', 5_000) })
    expect(latest).toEqual({ kind: 'none' })
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
