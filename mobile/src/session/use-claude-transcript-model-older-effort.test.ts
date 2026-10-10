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
import { resetClaudeTranscriptModelScansForTests } from './claude-transcript-model-scan'
import { claudeModelPillPair, type ClaudeModelFallback } from './claude-transcript-model'
import { EFFORT_HIGH_LINES, effortLines, modelWithEffortLines } from './fixtures/claude-effort-command-2.1.296'
import { clearPendingModelPicksForTests } from './mobile-native-chat-model-report-authority'
import { sessionModelPillLabel } from './session-model-pill'
import { resetClaudeTranscriptModelPicksForTests, useClaudeTranscriptModel } from './use-claude-transcript-model'

// Reported 2026-10-11: a Claude tab with no beacon (the status-line helper was
// not running) drew "Opus 5.5" in the header and composer pills with no
// effort, while the session's transcript held Claude Code's own answer to
// `/model` ("... with `medium` effort"). The chat loads only the last 40 rows,
// and the command was further back. The user: "read the effort from the
// transcript".
//
// Each test uses its own session id, so nothing a probe filed can carry over.

/** Orca's decodeClaudeTranscriptLine (stablyai/orca @ 5c7c4930,
 *  src/main/native-chat/transcript-line-decoders-claude.ts) for the records
 *  these fixtures hold: user and assistant rows only, an `isMeta` user row
 *  dropped, string content as one text block, the uuid as the id. */
function decodeLikeOrca(line: string): NativeChatMessage | null {
  const record = JSON.parse(line) as Record<string, unknown>
  if (record.type !== 'user' && record.type !== 'assistant') {
    return null
  }
  if (record.type === 'user' && record.isMeta === true) {
    return null
  }
  const content = (record.message as { content?: unknown } | undefined)?.content
  if (typeof content !== 'string') {
    return null
  }
  return {
    id: String(record.uuid),
    role: record.type,
    blocks: [{ type: 'text', text: content }],
    timestamp: Date.parse(String(record.timestamp)),
    source: 'transcript',
    ...(typeof record.parentUuid === 'string' ? { parentId: record.parentUuid } : {})
  }
}

const decode = (lines: readonly string[]): NativeChatMessage[] =>
  lines.map(decodeLikeOrca).filter((row): row is NativeChatMessage => row !== null)

let filler = 0
/** `count` ordinary turns after `at`, a minute apart: prompts and replies. */
function turns(count: number, at: number): NativeChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `turn-${(filler += 1)}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    blocks: [{ type: 'text', text: index % 2 === 0 ? 'next step please' : 'Done.' }],
    timestamp: at + (index + 1) * 60_000,
    source: 'transcript'
  }))
}

const T0 = Date.parse('2026-10-11T08:00:00.000Z')
const WINDOW = 40
const OPUS_MEDIUM_LINES = modelWithEffortLines('Opus 5.5', 'medium', '2026-10-11T08:00:00.000Z', 'a')

describe('a Claude chat with no beacon, whose /model or /effort answer is older than the loaded rows', () => {
  let host: AnsweringClient
  let file: NativeChatMessage[] = []
  /** What Orca's session scan says the session's last reply was written by. */
  let scanned: { sessionId: string; model: string } | null = null
  let renderer: ReactTestRenderer | null = null
  let latest: ClaudeModelFallback | null = null

  type Props = { sessionId: string; liveModel?: string | null; liveEffort?: string | null; beacon?: boolean; client?: AnsweringClient['client'] | null; rowsSettled?: boolean }
  function Harness({ sessionId, liveModel = null, liveEffort = null, beacon = false, client, rowsSettled }: Props) {
    latest = useClaudeTranscriptModel({
      client: client === undefined ? host.client : client,
      hostId: 'h',
      worktreeId: 'w',
      tabId: 't',
      sessionId,
      enabled: true,
      connected: true,
      liveModel,
      liveEffort,
      beacon,
      agentWorking: false,
      // What the chat holds: the transcript's last 40 rows.
      messages: file.slice(-WINDOW),
      rowsSettled
    }).fallback
    return null
  }
  const render = async (props: Props) => {
    await act(async () => {
      if (renderer) {
        renderer.update(createElement(Harness, props))
      } else {
        renderer = create(createElement(Harness, props))
      }
    })
    // Let the page reads the hook started come back.
    for (let index = 0; index < 20; index += 1) {
      await act(async () => {
        await Promise.resolve()
      })
    }
  }
  const pill = () => sessionModelPillLabel(claudeModelPillPair({ model: null, label: null, effort: null }, latest ?? { kind: 'none' }))
  const pageReads = () => host.sent('nativeChat.readSession')

  beforeEach(() => {
    resetSessionCommandPairCacheForTests()
    resetClaudeTranscriptModelScansForTests()
    resetClaudeTranscriptModelPicksForTests()
    clearPendingModelPicksForTests()
    file = []
    scanned = null
    // Orca's readSession: the last `limit` rows, or the `limit` rows before
    // `beforeOffset`, with the offset of the first row it sent.
    host = createAnsweringClient((method, params) => {
      if (method === 'aiVault.listSessions' && scanned !== null) {
        return ok({ sessions: [historySession(scanned)], issues: [] })
      }
      if (method !== 'nativeChat.readSession') {
        return refused('method_not_found', method)
      }
      const { limit, beforeOffset } = (params ?? {}) as { limit: number; beforeOffset?: number }
      const end = beforeOffset ?? file.length
      const start = Math.max(0, end - limit)
      return ok({ messages: file.slice(start, end), hasMore: start > 0, beforeOffset: start })
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = null
    vi.restoreAllMocks()
  })

  it('shows "Opus 5.5 Medium" when /model chose medium effort 300 rows before the loaded window', async () => {
    file = [...decode(OPUS_MEDIUM_LINES), ...turns(300, T0)]
    await render({ sessionId: 's-medium' })
    expect(latest).toMatchObject({ kind: 'transcript', model: { model: 'claude-opus-5-5', label: 'Opus 5.5' }, effort: 'medium' })
    expect(pill()).toBe('Opus 5.5 Medium')
  })

  // The newest record wins and the walk stops there: an /effort names no
  // model, so the model is the scan's, as it was in the report.
  it('shows High once a later /effort high (the captured 2.1.296 record) set it, still out of the window', async () => {
    scanned = { sessionId: 's-high', model: 'claude-opus-5-5' }
    file = [
      ...decode(OPUS_MEDIUM_LINES),
      ...turns(120, T0),
      ...decode(effortLines('high', '2026-10-11T10:30:00.000Z', 'b')),
      ...turns(120, Date.parse('2026-10-11T10:30:00.000Z'))
    ]
    await render({ sessionId: 's-high' })
    expect(latest).toMatchObject({ model: { label: 'Opus 5.5' }, effort: 'high' })
    expect(pill()).toBe('Opus 5.5 High')
  })

  it('reads the captured 2.1.296 /effort row, verbatim, as "high"', async () => {
    scanned = { sessionId: 's-verbatim', model: 'claude-opus-5-5' }
    file = [...decode(OPUS_MEDIUM_LINES), ...turns(60, T0), ...decode(EFFORT_HIGH_LINES).map((row) => ({ ...row, timestamp: T0 + 3_700_000 })), ...turns(60, T0 + 3_700_000)]
    await render({ sessionId: 's-verbatim' })
    expect(latest).toMatchObject({ effort: 'high' })
  })

  it('lets a beacon that states another effort win, and asks the host for nothing', async () => {
    file = [...decode(OPUS_MEDIUM_LINES), ...turns(300, T0)]
    await render({ sessionId: 's-beacon', liveModel: 'claude-opus-5-5', liveEffort: 'xhigh', beacon: true })
    expect(latest).toEqual({ kind: 'none' })
    expect(pill()).toBeNull()
    expect(pageReads()).toEqual([])
  })

  it('shows no effort when no record in the whole transcript states one', async () => {
    file = turns(300, T0)
    await render({ sessionId: 's-none' })
    expect(latest).toEqual({ kind: 'none' })
    // Searched to the start once, and not again on the next render.
    const asked = pageReads().length
    expect(asked).toBeGreaterThan(0)
    await render({ sessionId: 's-none' })
    expect(pageReads()).toHaveLength(asked)
  })

  it('does not read the host before the chat’s own first read has settled', async () => {
    file = [...decode(OPUS_MEDIUM_LINES), ...turns(300, T0)]
    await render({ sessionId: 's-unsettled', rowsSettled: false })
    expect(pageReads()).toEqual([])
    await render({ sessionId: 's-unsettled', rowsSettled: true })
    expect(latest).toMatchObject({ effort: 'medium' })
  })

  it('shows nothing for an empty transcript (a session before its first prompt)', async () => {
    file = []
    await render({ sessionId: 's-empty' })
    expect(latest).toEqual({ kind: 'none' })
  })

  it('finds a /model whose answer is the only thing before the window (first row of the file)', async () => {
    file = [...decode(OPUS_MEDIUM_LINES), ...turns(WINDOW, T0)]
    await render({ sessionId: 's-edge' })
    expect(latest).toMatchObject({ effort: 'medium' })
  })

  it('does not carry one session’s effort into another session shown in the same tab', async () => {
    file = [...decode(OPUS_MEDIUM_LINES), ...turns(300, T0)]
    await render({ sessionId: 's-first' })
    expect(latest).toMatchObject({ effort: 'medium' })
    file = turns(300, T0 + 86_400_000)
    await render({ sessionId: 's-second' })
    expect(latest).toEqual({ kind: 'none' })
  })

  it('keeps showing nothing when the host refuses the read, and logs which session it could not read', async () => {
    host = createAnsweringClient(() => refused('method_not_found', 'nativeChat.readSession'))
    file = [...decode(OPUS_MEDIUM_LINES), ...turns(300, T0)]
    await render({ sessionId: 's-refused', client: host.client })
    expect(latest).toEqual({ kind: 'none' })
    const warned = (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((call) => String(call[0]))
    expect(warned.some((line) => line.includes('s-refused') && line.includes('nativeChat.readSession'))).toBe(true)
  })
})
