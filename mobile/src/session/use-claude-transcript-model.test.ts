import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fakes = vi.hoisted(() => ({ lastConnectedAt: 1 as number | null }))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => fakes.lastConnectedAt
}))

import {
  createAnsweringClient,
  historySession,
  ok,
  refused,
  type AnsweringClient
} from '../agent-history/agent-history-panel.test-support'
import type { ClaudeModelFallback } from './claude-transcript-model'
import {
  CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS,
  resetClaudeTranscriptModelScansForTests
} from './claude-transcript-model-scan'
import {
  clearPendingModelPicksForTests,
  notePendingModelPick
} from './mobile-native-chat-model-report-authority'
import { mobileNativeChatScopeKey } from './mobile-native-chat-scope-key'
import {
  resetClaudeTranscriptModelPicksForTests,
  useClaudeTranscriptModel
} from './use-claude-transcript-model'

const HOST = 'host-win'
const WORKTREE = 'repo-1::C:\\Users\\danny\\code\\app'
const SESSION = 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607'
const SCOPE = mobileNativeChatScopeKey(HOST, WORKTREE, 'tab-1')!

type Probe = { liveModel?: string | null; beacon?: boolean; working?: boolean; sessionId?: string | null }

describe('when a Claude chat with no live model asks the host what answered', () => {
  let host: AnsweringClient
  let renderer: ReactTestRenderer | null = null
  let latest: { fallback: ClaudeModelFallback; requestScan: () => void } | null = null
  let model = 'claude-opus-5-5'

  function Harness({ liveModel = null, beacon = false, working = false, sessionId = SESSION }: Probe) {
    latest = useClaudeTranscriptModel({
      client: host.client,
      hostId: HOST,
      worktreeId: WORKTREE,
      tabId: 'tab-1',
      sessionId,
      enabled: true,
      connected: true,
      liveModel,
      beacon,
      agentWorking: working
    })
    return null
  }

  function render(probe: Probe = {}): void {
    act(() => {
      if (renderer) {
        renderer.update(createElement(Harness, probe))
      } else {
        renderer = create(createElement(Harness, probe))
      }
    })
  }

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  const scans = (): number => host.sent('aiVault.listSessions').length

  /** Lets the host's answer land with NO timer advanced: only promises settle. */
  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve()
      }
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-09-27T10:10:00.000Z'))
    resetClaudeTranscriptModelScansForTests()
    clearPendingModelPicksForTests()
    resetClaudeTranscriptModelPicksForTests()
    fakes.lastConnectedAt = 1
    model = 'claude-opus-5-5'
    host = createAnsweringClient((method) =>
      method === 'aiVault.listSessions'
        ? ok({
            sessions: [
              historySession({
                sessionId: SESSION,
                model,
                previewMessages: [{ role: 'assistant', text: 'Done.', timestamp: null }]
              })
            ],
            issues: []
          })
        : refused('method_not_found', method)
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = null
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // 2026-10-09: the pill must appear near-instantly on opening a chat, on
  // every host. Nothing waits on a timer before the host is asked: the scan
  // reading is the session's own last-answered model, and a beacon or a badge
  // that speaks later replaces it (tier 1).
  it('shows the model on the render the scan answers in, with no timer advanced, on any tab', async () => {
    render()
    await flush()
    expect(scans()).toBe(1)
    expect(latest?.fallback).toMatchObject({ kind: 'transcript', model: { label: 'Opus 5.5' } })
  })

  it('asks on mount for a tab that may still beacon too, and gives way to the beacon when it speaks', async () => {
    render()
    await flush()
    expect(scans()).toBe(1)
    expect(latest?.fallback).toMatchObject({ kind: 'transcript', model: { label: 'Opus 5.5' } })
    render({ liveModel: 'claude-fable-5-1', beacon: true })
    expect(latest?.fallback).toEqual({ kind: 'none' })
  })

  it('asks nothing while the status line states the model, or before the tab knows its session', async () => {
    render({ liveModel: 'claude-fable-5-1' })
    await advance(0)
    expect(scans()).toBe(0)
    render({ sessionId: null })
    await advance(0)
    expect(scans()).toBe(0)
  })

  it('asks nothing and states nothing before the tab knows its session', async () => {
    render({ sessionId: null })
    await advance(10_000)
    latest?.requestScan()
    await advance(0)
    expect(scans()).toBe(0)
    expect(latest?.fallback).toEqual({ kind: 'none' })
  })

  it('asks when the user opens the model sheet, inside the same five-minute budget', async () => {
    render()
    act(() => latest?.requestScan())
    await advance(0)
    expect(scans()).toBe(1)
    expect(latest?.fallback).toMatchObject({ kind: 'transcript', model: { label: 'Opus 5.5' } })
    // The chat's own settle-time ask lands inside the budget and is skipped.
    await advance(0)
    act(() => latest?.requestScan())
    await advance(0)
    expect(scans()).toBe(1)
  })

  it('asks again on a new connection once the budget allows, never before', async () => {
    render()
    await advance(0)
    expect(scans()).toBe(1)
    fakes.lastConnectedAt = 2
    render()
    await advance(0)
    expect(scans()).toBe(1)
    await advance(CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS)
    fakes.lastConnectedAt = 3
    render()
    await advance(0)
    expect(scans()).toBe(2)
  })

  it("shows nothing after the phone's own pick, then asks once when the next turn ends, and not on the turns after", async () => {
    render()
    await advance(0)
    expect(scans()).toBe(1)
    await advance(CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS)

    // The phone switches to Sonnet at the idle prompt. The transcript still
    // says Opus answered last, which the switch may have replaced, and the
    // pick itself is not the agent's word: the pill states neither.
    notePendingModelPick(SCOPE, 'sonnet', null)
    render()
    expect(latest?.fallback).toEqual({ kind: 'none' })
    expect(scans()).toBe(1)

    // The next prompt runs under Sonnet; that turn ending is the ask.
    model = 'claude-sonnet-5'
    render({ working: true })
    await advance(60_000)
    expect(latest?.fallback).toEqual({ kind: 'none' })
    render({ working: false })
    await advance(0)
    expect(scans()).toBe(2)
    expect(latest?.fallback).toEqual({
      kind: 'transcript',
      model: { model: 'claude-sonnet-5', label: 'Sonnet 5' },
      freshAsOf: expect.any(Number)
    })

    // Later turns ask nothing more.
    await advance(CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS)
    render({ working: true })
    render({ working: false })
    await advance(0)
    expect(scans()).toBe(2)
  })

  it('shows nothing through the end of a turn a pick was made in, which Claude Code finishes on the old model', async () => {
    render()
    await advance(0)
    await advance(CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS)

    // Opus is working; the phone picks Sonnet. Claude Code queues the switch
    // and applies it when this turn ends, so this turn's reply is still Opus.
    render({ working: true })
    notePendingModelPick(SCOPE, 'sonnet', null)
    render({ working: true })
    render({ working: false })
    await advance(0)
    expect(scans()).toBe(1)
    expect(latest?.fallback).toEqual({ kind: 'none' })

    // The turn after it is the first to run under the switch.
    model = 'claude-sonnet-5'
    render({ working: true })
    render({ working: false })
    await advance(0)
    expect(scans()).toBe(2)
    expect(latest?.fallback).toMatchObject({ kind: 'transcript', model: { label: 'Sonnet 5' } })
  })

  it('never shows a pick the agent refused, and shows what answered once a turn after it is scanned', async () => {
    render()
    await advance(0)
    await advance(CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS)
    // The switch never took (a dismissed confirmation): the next reply is Opus.
    notePendingModelPick(SCOPE, 'sonnet', null)
    render()
    expect(latest?.fallback).toEqual({ kind: 'none' })
    render({ working: true })
    expect(latest?.fallback).toEqual({ kind: 'none' })
    render({ working: false })
    await advance(0)
    expect(scans()).toBe(2)
    expect(latest?.fallback).toMatchObject({ kind: 'transcript', model: { label: 'Opus 5.5' } })
  })

  it("does not carry a pick made in one session into the next session in the same tab", async () => {
    render()
    await advance(0)
    notePendingModelPick(SCOPE, 'sonnet', null)
    render()
    // `/clear` in the same tab: a new session under the same scope.
    const NEXT = '0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f'
    render({ sessionId: NEXT })
    await advance(0)
    expect(latest?.fallback).toEqual({ kind: 'none' })
  })

  it("does not take the host's cached answer from before the turn that confirms a pick", async () => {
    render()
    await advance(0)
    await advance(CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS)
    notePendingModelPick(SCOPE, 'sonnet', null)
    render()
    model = 'claude-sonnet-5'
    render({ working: true })
    render({ working: false })
    await advance(0)
    // The host shares one cache slot with the history screen and answers from
    // it for up to a minute; this scan must read the transcript as it is now.
    expect(host.sent('aiVault.listSessions').at(-1)?.params).toMatchObject({ force: true })
    expect(host.sent('aiVault.listSessions')[0]?.params).toMatchObject({ force: false })
  })

  it('runs the confirming scan when the five minutes allow it, and shows nothing until then', async () => {
    render()
    await advance(0)
    expect(scans()).toBe(1)
    // A minute later the phone picks Sonnet and a turn runs under it: the
    // scan that would confirm it falls inside the budget.
    await advance(60_000)
    notePendingModelPick(SCOPE, 'sonnet', null)
    render()
    model = 'claude-sonnet-5'
    render({ working: true })
    render({ working: false })
    await advance(0)
    expect(scans()).toBe(1)
    expect(latest?.fallback).toEqual({ kind: 'none' })

    await advance(CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS)
    expect(scans()).toBe(2)
    expect(host.sent('aiVault.listSessions')[1]?.params).toMatchObject({ force: true })
    expect(latest?.fallback).toMatchObject({ kind: 'transcript', model: { label: 'Sonnet 5' } })
  })

  it('shows the model once the relay reconnects, after a first scan that failed', async () => {
    let refuse = true
    host = createAnsweringClient((method) =>
      method === 'aiVault.listSessions' && !refuse
        ? ok({ sessions: [historySession({ sessionId: SESSION, model })], issues: [] })
        : refused('unavailable', 'relay not ready')
    )
    render()
    await advance(0)
    expect(scans()).toBe(1)
    expect(latest?.fallback).toEqual({ kind: 'none' })

    refuse = false
    fakes.lastConnectedAt = 2
    render()
    await advance(0)
    expect(scans()).toBe(2)
    expect(latest?.fallback).toMatchObject({ kind: 'transcript', model: { label: 'Opus 5.5' } })
  })

  it('keeps one answer object across renders, so the pickers are not rebuilt every render', async () => {
    render()
    await advance(0)
    const first = latest?.fallback
    expect(first?.kind).toBe('transcript')
    render()
    render()
    expect(latest?.fallback).toBe(first)
  })

  it('states nothing once a live pair speaks, whatever the last scan said', async () => {
    render()
    await advance(0)
    expect(latest?.fallback.kind).toBe('transcript')
    render({ liveModel: 'claude-fable-5-1' })
    expect(latest?.fallback).toEqual({ kind: 'none' })
  })
})
