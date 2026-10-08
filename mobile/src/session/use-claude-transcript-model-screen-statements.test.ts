import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../transport/client-context-connection-metrics', () => ({ useLastConnectedAt: () => 1 }))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined) }
}))

import { createAnsweringClient, historySession, ok, refused, type AnsweringClient } from '../agent-history/agent-history-panel.test-support'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { peekScreenModelRecord, resetScreenModelRecordsForTests } from './claude-screen-model-pair'
import { readClaudeScreenModelStatement, type ClaudeScreenModelStatement } from './claude-screen-model-statement'
import { resetSessionCommandPairCacheForTests } from './claude-session-command-pair'
import { rememberStartupFramePair, resetStartupFramePairsForTests } from './claude-startup-frame-pair'
import { readClaudeStartupFrame } from './claude-startup-frame'
import { resetClaudeTranscriptModelScansForTests } from './claude-transcript-model-scan'
import type { ClaudeModelFallback } from './claude-transcript-model'
import { QUOTED_IN_REPLY, WIDE_TOAST_OPUS, WIDE_TOAST_SONNET } from './fixtures/claude-model-toast-2.1.294'
import { NARROW_SPINNER_HIGH, NARROW_SPINNER_WRAPPED, WIDE_IDLE_AFTER_TURN, WIDE_SONNET_THINKING_NO_EFFORT, WIDE_SPINNER_HIGH_AFTER_PICK, WIDE_SPINNER_XHIGH, WIDE_THOUGHT_NO_EFFORT } from './fixtures/claude-spinner-effort-2.1.294'
import { LOGO_FRAME } from './fixtures/claude-startup-frame-2.1.290-modelled'
import { clearPendingModelPicksForTests } from './mobile-native-chat-model-report-authority'
import {
  CLAUDE_TRANSCRIPT_MODEL_SETTLE_MS,
  resetClaudeTranscriptModelPicksForTests,
  useClaudeTranscriptModel
} from './use-claude-transcript-model'

// Claude Code 2.1.294. Every screen is a real capture (the fixture file says how
// it was taken); each is turned into what the HUD's screen poll hands this hook.
const HOST = 'h'
const SESSION = 's-1'
const read = (lines: readonly string[]): ClaudeScreenModelStatement => readClaudeScreenModelStatement(lines)

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

type Probe = {
  liveModel?: string | null
  beacon?: boolean
  sessionId?: string | null
  messages?: NativeChatMessage[]
  screen?: ClaudeScreenModelStatement | null
}

describe('the model and effort a Claude tab with nothing set up states on its own screen', () => {
  let host: AnsweringClient
  let renderer: ReactTestRenderer | null = null
  let latest: ClaudeModelFallback | null = null
  let scannedModel: string | null = null
  let lastProbe: Probe = {}

  function Harness({ liveModel = null, beacon = false, sessionId = SESSION, messages = [], screen = null }: Probe) {
    latest = useClaudeTranscriptModel({
      client: host.client,
      hostId: HOST,
      worktreeId: 'w',
      tabId: 't',
      sessionId,
      enabled: true,
      connected: true,
      liveModel,
      beacon,
      beaconHandle: 'term-1',
      agentWorking: false,
      messages,
      screenStatement: screen
    }).fallback
    return null
  }
  const render = (probe: Probe) =>
    act(() => {
      lastProbe = { ...lastProbe, ...probe }
      if (renderer) {
        renderer.update(createElement(Harness, lastProbe))
      } else {
        renderer = create(createElement(Harness, lastProbe))
      }
    })
  /** One screen poll: the HUD hands over what this screen shows. */
  const poll = async (lines: readonly string[], probe: Probe = {}) => {
    render({ ...probe, screen: read(lines) })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
  }
  const pair = () =>
    latest?.kind === 'transcript' ? { model: latest.model.model, effort: latest.effort ?? null } : { model: null, effort: null }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-10-08T19:00:00.000Z'))
    resetStartupFramePairsForTests()
    resetSessionCommandPairCacheForTests()
    resetClaudeTranscriptModelScansForTests()
    resetClaudeTranscriptModelPicksForTests()
    resetScreenModelRecordsForTests()
    clearPendingModelPicksForTests()
    scannedModel = null
    lastProbe = {}
    host = createAnsweringClient((method) => {
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

  /** Opus 5.5 at xhigh, from the session's own toast and first thinking turn. */
  const opusXhigh = async () => {
    await poll(WIDE_TOAST_OPUS)
    await poll(WIDE_IDLE_AFTER_TURN)
    await poll(WIDE_SPINNER_XHIGH)
  }

  it('follows an effort switch made in the picker on the next thinking turn', async () => {
    await opusXhigh()
    expect(pair()).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
    // alt+p, the slider to High, `s`: the toast names the model, then the next turn states the effort.
    await poll(WIDE_IDLE_AFTER_TURN)
    await poll(WIDE_TOAST_OPUS)
    expect(pair()).toEqual({ model: 'claude-opus-5-5', effort: null })
    await poll(WIDE_IDLE_AFTER_TURN)
    await poll(WIDE_SPINNER_HIGH_AFTER_PICK)
    expect(pair()).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  })

  it('overrides the startup frame and a /effort row the phone already held, by a later thinking turn', async () => {
    rememberStartupFramePair(SESSION, readClaudeStartupFrame(LOGO_FRAME))
    const messages = ran('effort', 'Set effort level to low (this session only): Quick')
    render({ messages })
    await poll(WIDE_IDLE_AFTER_TURN)
    expect(pair()).toEqual({ model: 'claude-opus-5', effort: 'low' })
    await poll(WIDE_SPINNER_XHIGH)
    expect(pair()).toEqual({ model: 'claude-opus-5', effort: 'xhigh' })
  })

  it('lets a /effort row written after the thinking turn win over it', async () => {
    rememberStartupFramePair(SESSION, readClaudeStartupFrame(LOGO_FRAME))
    await poll(WIDE_SPINNER_XHIGH)
    expect(pair()).toEqual({ model: 'claude-opus-5', effort: 'xhigh' })
    await poll(WIDE_IDLE_AFTER_TURN, { messages: ran('effort', 'Set effort level to low (this session only): Quick') })
    expect(pair()).toEqual({ model: 'claude-opus-5', effort: 'low' })
  })

  it('keeps the last effort through a spinner that states none', async () => {
    await opusXhigh()
    await poll(WIDE_THOUGHT_NO_EFFORT)
    expect(pair()).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
    await poll(WIDE_IDLE_AFTER_TURN)
    expect(pair()).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
  })

  it('does not read a spinner row or a toast quoted in a reply', async () => {
    await opusXhigh()
    await poll(QUOTED_IN_REPLY)
    expect(pair()).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
  })

  it('switches the model on an alt+p toast and clears the effort the old model had', async () => {
    await opusXhigh()
    await poll(WIDE_IDLE_AFTER_TURN)
    await poll(WIDE_TOAST_SONNET)
    expect(pair()).toEqual({ model: 'claude-sonnet-5-5', effort: null })
    // Sonnet 5.5 thinks without stating an effort: still none.
    await poll(WIDE_IDLE_AFTER_TURN)
    await poll(WIDE_SONNET_THINKING_NO_EFFORT)
    expect(pair()).toEqual({ model: 'claude-sonnet-5-5', effort: null })
  })

  it('switches the model on a toast over a /model row the phone already held', async () => {
    render({ messages: ran('model', 'Set model to `Opus 5.5` for this session only with `xhigh` effort') })
    await poll(WIDE_IDLE_AFTER_TURN)
    expect(pair()).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
    await poll(WIDE_TOAST_SONNET)
    expect(pair()).toEqual({ model: 'claude-sonnet-5-5', effort: null })
  })

  it("does not take the old model's spinner, still up when the toast came, as the new model's effort", async () => {
    await opusXhigh()
    // The toast lands on a screen whose turn (the old model's) is still running.
    const toastRow = WIDE_TOAST_SONNET.find((line) => line.includes('Model set to'))!
    const toastOverTurn = WIDE_SPINNER_XHIGH.map((line) => (line.startsWith('  ⏵⏵') ? toastRow : line))
    expect(read(toastOverTurn)).toMatchObject({ spinner: true, effort: 'xhigh', toast: { model: 'claude-sonnet-5-5' } })
    await poll(toastOverTurn)
    await poll(WIDE_SPINNER_XHIGH)
    expect(pair()).toEqual({ model: 'claude-sonnet-5-5', effort: null })
    // Once that turn has ended, the next one speaks for the new model.
    await poll(WIDE_IDLE_AFTER_TURN)
    await poll(WIDE_SPINNER_HIGH_AFTER_PICK)
    expect(pair()).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  })

  it('lets a scan taken after a reply written under another model replace a toast the phone saw earlier', async () => {
    render({ messages: [row('user', 'hi'), row('assistant', 'hello')] })
    await poll(WIDE_TOAST_SONNET)
    expect(pair()).toEqual({ model: 'claude-sonnet-5-5', effort: null })
    // A second switch while the phone was away writes nothing it can see; a reply comes, then a scan.
    const reply = row('assistant', 'answered under Fable')
    scannedModel = 'claude-fable-5-1'
    await poll(WIDE_IDLE_AFTER_TURN, { messages: [row('user', 'hi'), row('assistant', 'hello'), reply] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLAUDE_TRANSCRIPT_MODEL_SETTLE_MS + 10)
    })
    await poll(WIDE_IDLE_AFTER_TURN)
    expect(pair()).toEqual({ model: 'claude-fable-5-1', effort: null })
  })

  it('keeps a toast over a scan that came before any reply under the new model', async () => {
    render({ messages: [row('user', 'hi'), row('assistant', 'hello')] })
    scannedModel = 'claude-opus-5-5'
    await poll(WIDE_TOAST_SONNET)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLAUDE_TRANSCRIPT_MODEL_SETTLE_MS + 10)
    })
    await poll(WIDE_IDLE_AFTER_TURN)
    expect(pair()).toEqual({ model: 'claude-sonnet-5-5', effort: null })
  })

  it('gives no effort from a phone-width spinner that wrapped, and reads one that fits', async () => {
    await poll(WIDE_TOAST_OPUS)
    await poll(WIDE_IDLE_AFTER_TURN)
    await poll(NARROW_SPINNER_WRAPPED)
    expect(pair()).toEqual({ model: 'claude-opus-5-5', effort: null })
    await poll(NARROW_SPINNER_HIGH)
    expect(pair()).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  })

  it('states nothing from a spinner alone when no source names the model', async () => {
    await poll(WIDE_SPINNER_XHIGH)
    expect(latest).toEqual({ kind: 'none' })
  })

  it('changes nothing on an empty screen', async () => {
    await opusXhigh()
    await poll([])
    expect(pair()).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
  })

  it('records nothing for a tab that does not know its session yet', async () => {
    await poll(WIDE_TOAST_SONNET, { sessionId: null })
    await poll(WIDE_SPINNER_XHIGH, { sessionId: null })
    expect(peekScreenModelRecord(SESSION)).toBeNull()
    expect(latest).toEqual({ kind: 'none' })
  })

  it('leaves the pills to a live beacon or badge while one speaks', async () => {
    await opusXhigh()
    await poll(WIDE_TOAST_SONNET, { liveModel: 'claude-fable-5-1', beacon: true })
    expect(latest).toEqual({ kind: 'none' })
    await poll(WIDE_SPINNER_HIGH_AFTER_PICK, { liveModel: 'claude-fable-5-1', beacon: true })
    expect(latest).toEqual({ kind: 'none' })
  })
})
