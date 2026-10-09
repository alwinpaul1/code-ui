import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../transport/client-context-connection-metrics', () => ({ useLastConnectedAt: () => 1 }))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined) }
}))

import { createAnsweringClient, historySession, ok, refused, type AnsweringClient } from '../agent-history/agent-history-panel.test-support'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { resetSessionCommandPairCacheForTests } from './claude-session-command-pair'
import { peekStartupFramePair, rememberStartupFramePair, resetStartupFramePairsForTests } from './claude-startup-frame-pair'
import { readClaudeStartupFrame } from './claude-startup-frame'
import { resetClaudeTranscriptModelScansForTests } from './claude-transcript-model-scan'
import type { ClaudeModelFallback } from './claude-transcript-model'
import { LOGO_FRAME, SCROLLED_PAST, SECOND_RUN_FRAME } from './fixtures/claude-startup-frame-2.1.290-modelled'
import { clearPendingModelPicksForTests, notePendingModelPick } from './mobile-native-chat-model-report-authority'
import { mobileNativeChatScopeKey } from './mobile-native-chat-scope-key'
import {
  resetClaudeTranscriptModelPicksForTests,
  useClaudeTranscriptModel
} from './use-claude-transcript-model'

// The screens are MODELLED, none captured (fixtures/claude-startup-frame-2.1.290-modelled.ts).
const HOST = 'h'
const SESSION = 's-1'
const HANDLE = 'term-1'
const OPUS_XHIGH = { kind: 'transcript', model: { model: 'claude-opus-5', label: 'Opus 5' }, effort: 'xhigh' }

let clock = 0
const row = (role: 'user' | 'assistant', body: string): NativeChatMessage => ({
  id: `m${(clock += 1)}`,
  role,
  blocks: [{ type: 'text', text: body }],
  timestamp: clock * 1000,
  source: 'transcript'
})
const ran = (name: string, body: string) => [
  row('user', `<command-name>/${name}</command-name>\n<command-args></command-args>`),
  row('user', `<local-command-stdout>${body}</local-command-stdout>`)
]

type Probe = { liveModel?: string | null; beacon?: boolean; sessionId?: string | null; messages?: NativeChatMessage[]; connected?: boolean }

describe('a hand-typed Claude tab with no beacon and no badge', () => {
  let host: AnsweringClient
  let renderer: ReactTestRenderer | null = null
  let latest: ClaudeModelFallback | null = null
  let streamRows: string[] = []
  let scannedModel: string | null = null

  function Harness({ liveModel = null, beacon = false, sessionId = SESSION, messages, connected = true }: Probe) {
    latest = useClaudeTranscriptModel({
      client: host.client,
      hostId: HOST,
      worktreeId: 'w',
      tabId: 't',
      sessionId,
      enabled: true,
      connected,
      liveModel,
      beacon,
      beaconHandle: HANDLE,
      agentWorking: false,
      messages
    }).fallback
    return null
  }
  const render = (probe: Probe = {}) =>
    act(() => {
      if (renderer) {
        renderer.update(createElement(Harness, probe))
      } else {
        renderer = create(createElement(Harness, probe))
      }
    })
  const settle = async (ms = 0) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }
  const streamReads = () => host.sent('terminal.read')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-10-06T10:00:00.000Z'))
    resetStartupFramePairsForTests()
    resetSessionCommandPairCacheForTests()
    resetClaudeTranscriptModelScansForTests()
    resetClaudeTranscriptModelPicksForTests()
    clearPendingModelPicksForTests()
    streamRows = []
    scannedModel = null
    host = createAnsweringClient((method) => {
      if (method === 'terminal.read') {
        return ok({ terminal: { tail: streamRows, source: 'stream' } })
      }
      if (method === 'aiVault.listSessions' && scannedModel !== null) {
        return ok({ sessions: [historySession({ sessionId: SESSION, model: scannedModel })], issues: [] })
      }
      return refused('method_not_found', method)
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = null
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shows the model and effort it started with, read off the frame the screen poll saw', async () => {
    rememberStartupFramePair(SESSION, readClaudeStartupFrame(LOGO_FRAME))
    render({ messages: [] })
    await settle()
    expect(latest).toEqual(OPUS_XHIGH)
  })

  it('keeps the pair when the frame has scrolled out of the screen, and asks the host for nothing', async () => {
    rememberStartupFramePair(SESSION, readClaudeStartupFrame(LOGO_FRAME))
    render({ messages: [] })
    await settle()
    render({ messages: [row('assistant', 'a reply, much later')] })
    await settle()
    expect(latest).toEqual(OPUS_XHIGH)
    expect(streamReads()).toEqual([])
  })

  it('shows nothing for a late attach whose screen no longer holds the frame, rather than reading the host\'s oldest rows', async () => {
    streamRows = [...LOGO_FRAME, ...SCROLLED_PAST]
    render({ messages: [] })
    await settle(10_000)
    expect(latest).toEqual({ kind: 'none' })
    expect(peekStartupFramePair(SESSION)).toBeNull()
    expect(streamReads()).toEqual([])
  })

  // The reviewer's probe. A terminal ran `claude` (session A, Opus 5 xhigh), exited, then ran
  // `claude --model sonnet --effort low` (session B). The host's stream buffer is append-only from the
  // PTY's spawn, so an oldest-first read answers A's frame, and it was filed under B.
  it("does not file the first claude's launch pair under the second claude's session", async () => {
    const runA = [...LOGO_FRAME, ...SCROLLED_PAST, '$ ']
    const runB = ['$ claude --model sonnet --effort low', ...SECOND_RUN_FRAME]
    streamRows = [...runA, ...runB]
    render({ sessionId: 'session-B', messages: [] })
    await settle(10_000)
    expect(peekStartupFramePair('session-B')).toBeNull()
    expect(latest).toEqual({ kind: 'none' })
    expect(streamReads()).toEqual([])
  })

  it('does not read the host before the tab knows its session, or while disconnected', async () => {
    streamRows = LOGO_FRAME
    render({ sessionId: null })
    await settle()
    render({ connected: false })
    await settle()
    expect(streamReads()).toEqual([])
    expect(latest).toEqual({ kind: 'none' })
  })

  it('lets a /model typed after start override the frame, with no effort of the frame carried to the new model', async () => {
    rememberStartupFramePair(SESSION, readClaudeStartupFrame(LOGO_FRAME))
    render({ messages: ran('model', 'Set model to `Sonnet 5` for this session only') })
    await settle()
    expect(latest).toMatchObject({ kind: 'transcript', model: { model: 'claude-sonnet-5' }, effort: null })
  })

  it('lets an /effort typed after start override the effort and keep the frame model', async () => {
    rememberStartupFramePair(SESSION, readClaudeStartupFrame(LOGO_FRAME))
    render({ messages: ran('effort', 'Set effort level to low (this session only): Quick') })
    await settle()
    expect(latest).toMatchObject({ kind: 'transcript', model: { model: 'claude-opus-5' }, effort: 'low' })
  })

  it('leaves the frame stale after an effort-step key, which writes nothing the phone can read', async () => {
    rememberStartupFramePair(SESSION, readClaudeStartupFrame(LOGO_FRAME))
    render({ messages: [row('user', 'hello'), row('assistant', 'hi')] })
    await settle()
    // Documented limit (docs/mobile-agent-hud.md): the pair is what the frame said at launch.
    expect(latest).toEqual(OPUS_XHIGH)
  })

  it('states nothing when a live beacon or badge speaks, or a beacon has been heard', async () => {
    rememberStartupFramePair(SESSION, readClaudeStartupFrame(LOGO_FRAME))
    render({ liveModel: 'claude-fable-5-1', messages: [] })
    await settle()
    expect(latest).toEqual({ kind: 'none' })
    render({ beacon: true, messages: [] })
    await settle()
    expect(latest).toEqual({ kind: 'none' })
  })

  it('shows nothing after a model pick the phone made that no scan has confirmed', async () => {
    rememberStartupFramePair(SESSION, readClaudeStartupFrame(LOGO_FRAME))
    notePendingModelPick(mobileNativeChatScopeKey(HOST, 'w', 't')!, 'claude-fable-5-1', null)
    render({ messages: [] })
    await settle()
    expect(latest).toEqual({ kind: 'none' })
  })

  it("takes the scan's model, with no frame effort, when the scan names another model than the frame", async () => {
    rememberStartupFramePair(SESSION, readClaudeStartupFrame(LOGO_FRAME))
    scannedModel = 'claude-fable-5-1'
    render({ messages: [] })
    await settle(10)
    render({ messages: [] })
    await settle()
    expect(latest).toMatchObject({ kind: 'transcript', model: { model: 'claude-fable-5-1' } })
    expect((latest as { effort?: string | null }).effort ?? null).toBeNull()
  })

  it('adds the frame effort to a scan that names the same model', async () => {
    rememberStartupFramePair(SESSION, readClaudeStartupFrame(LOGO_FRAME))
    scannedModel = 'claude-opus-5'
    render({ messages: [] })
    await settle(10)
    render({ messages: [] })
    await settle()
    expect(latest).toMatchObject({ kind: 'transcript', model: { model: 'claude-opus-5' }, effort: 'xhigh' })
  })
})
