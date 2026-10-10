import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../transport/client-context-connection-metrics', () => ({ useLastConnectedAt: () => 1 }))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined) }
}))

import { createAnsweringClient, historySession, ok, refused, type AnsweringClient } from '../agent-history/agent-history-panel.test-support'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { resetScreenModelRecordsForTests } from './claude-screen-model-pair'
import { readClaudeScreenModelStatement, type ClaudeScreenModelStatement } from './claude-screen-model-statement'
import { resetSessionCommandPairCacheForTests } from './claude-session-command-pair'
import { resetTranscriptEffortProbesForTests } from './claude-transcript-effort-probe'
import { resetClaudeTranscriptModelScansForTests } from './claude-transcript-model-scan'
import type { ClaudeModelFallback } from './claude-transcript-model'
import { effortLines, modelWithEffortLines } from './fixtures/claude-effort-command-2.1.296'
import { WIDE_TOAST_OPUS } from './fixtures/claude-model-toast-2.1.294'
import { WIDE_SPINNER_XHIGH } from './fixtures/claude-spinner-effort-2.1.294'
import { clearPendingModelPicksForTests } from './mobile-native-chat-model-report-authority'
import { resetClaudeTranscriptModelPicksForTests, useClaudeTranscriptModel } from './use-claude-transcript-model'

function decode(lines: readonly string[]): NativeChatMessage[] {
  return lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((r) => (r.type === 'user' || r.type === 'assistant') && r.isMeta !== true)
    .map((r) => ({
      id: String(r.uuid),
      role: r.type as 'user' | 'assistant',
      blocks: [{ type: 'text' as const, text: String((r.message as { content: string }).content) }],
      timestamp: Date.parse(String(r.timestamp)),
      source: 'transcript' as const
    }))
}
let n = 0
const turns = (count: number, at: number): NativeChatMessage[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `t${(n += 1)}`,
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    blocks: [{ type: 'text' as const, text: i % 2 === 0 ? 'go' : 'Done.' }],
    timestamp: at + (i + 1) * 60_000,
    source: 'transcript' as const
  }))

const T0 = Date.parse('2026-10-11T08:00:00.000Z')

describe('an answer dug out of older transcript rows never beats what the screen said since (review of 1bd638852)', () => {
  let host: AnsweringClient
  let file: NativeChatMessage[] = []
  let scanned: { sessionId: string; model: string } | null = null
  let release: () => void = () => {}
  let gate: Promise<void> = Promise.resolve()
  let renderer: ReactTestRenderer | null = null
  let latest: ClaudeModelFallback | null = null
  type P = { sessionId: string; screen: ClaudeScreenModelStatement | null }
  function Harness({ sessionId, screen }: P) {
    latest = useClaudeTranscriptModel({
      client: host.client, hostId: 'h', worktreeId: 'w', tabId: 't', sessionId, enabled: true, connected: true,
      liveModel: null, beacon: false, agentWorking: false, messages: file.slice(-40), screenStatement: screen
    }).fallback
    return null
  }
  const render = async (p: P) => {
    await act(async () => {
      if (renderer) {renderer.update(createElement(Harness, p))}
      else {renderer = create(createElement(Harness, p))}
    })
    for (let i = 0; i < 20; i += 1) {await act(async () => { await Promise.resolve() })}
  }
  const flush = async () => { for (let i = 0; i < 30; i += 1) {await act(async () => { await Promise.resolve() })} }
  const pair = () => (latest?.kind === 'transcript' ? { model: latest.model.model, effort: latest.effort ?? null } : null)

  beforeEach(() => {
    resetSessionCommandPairCacheForTests()
    resetClaudeTranscriptModelScansForTests()
    resetClaudeTranscriptModelPicksForTests()
    resetScreenModelRecordsForTests()
    resetTranscriptEffortProbesForTests()
    clearPendingModelPicksForTests()
    gate = new Promise((resolve) => { release = resolve })
    host = createAnsweringClient(((method: string, params: unknown) => {
      if (method === 'aiVault.listSessions' && scanned !== null) {return ok({ sessions: [historySession(scanned)], issues: [] })}
      if (method !== 'nativeChat.readSession') {return refused('method_not_found', method)}
      const { limit, beforeOffset } = (params ?? {}) as { limit: number; beforeOffset?: number }
      const end = beforeOffset ?? file.length
      const start = Math.max(0, end - limit)
      // The host's page read takes a moment (a relay round trip).
      return gate.then(() => ok({ messages: file.slice(start, end), hasMore: start > 0, beforeOffset: start }))
    }) as never)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })

  it('keeps an alt+p toast (Opus) seen on screen over a /model Sonnet answered hours earlier', async () => {
    file = [...decode(modelWithEffortLines('Sonnet 5', 'high', '2026-10-11T08:00:00.000Z', 'a')), ...turns(300, T0)]
    await render({ sessionId: 's-toast', screen: readClaudeScreenModelStatement(WIDE_TOAST_OPUS) })
    expect(pair()?.model).toBe('claude-opus-5-5') // the toast, before the probe answers
    release()
    await flush()
    expect(pair()?.model).toBe('claude-opus-5-5')
  })

  it('keeps the spinner effort (xhigh) seen on screen over an /effort medium typed hours earlier', async () => {
    scanned = { sessionId: 's-spin', model: 'claude-opus-5-5' }
    file = [...decode(effortLines('medium', '2026-10-11T08:00:00.000Z', 'b')), ...turns(300, T0)]
    await render({ sessionId: 's-spin', screen: null })
    await render({ sessionId: 's-spin', screen: readClaudeScreenModelStatement(WIDE_SPINNER_XHIGH) })
    expect(pair()).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' }) // the spinner, before the probe answers
    release()
    await flush()
    expect(pair()).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
  })
})
