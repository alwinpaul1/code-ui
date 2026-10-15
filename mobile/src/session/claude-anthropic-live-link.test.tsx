import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setAnthropicSignInReaderForTests } from './anthropic-sign-in-presence'
import { resetCcrLinksForTests, setCcrLinkDepsLoader, setCcrLinkTimerForTests } from './ccr-link-registry'
import { resetCcrMatchOutcomesForTests } from './ccr-match-outcome'
import { parseCcrEvent, type CcrFetch } from './ccr-session-api'
import { resetCcrCacheForTests, setCcrMapping } from './ccr-session-cache'
import type { CcrLinkDeps } from './ccr-session-link'
import { flushCcrTranscriptsForTests, resetCcrTranscriptsForTests, writeCcrTranscript } from './ccr-transcript-persist'
import { useClaudeAnthropicTranscript, type ClaudeAnthropicTranscript } from './use-claude-anthropic-transcript'
import { SESSION_A, event, eventsReply, reply } from './fixtures/ccr-session-api-2026-10-14'
import { sseBody, sseFrame, streamFetch } from './fixtures/ccr-session-stream'

// A matched Claude tab's live state, end to end through the session link: history page, then the
// stream (`client_event`, `ephemeral_event`, `session_update` frames, ccr-event-stream.ts).

const TAB = 'tab-1'
const AGENT_SESSION = '3f0c6d2e-claude-session'
const ACCOUNT = 'acct-work'
const EPOCH = 7

let renderer: ReactTestRenderer | null = null
const seen: ClaudeAnthropicTranscript[] = []

function Probe() {
  seen.push(useClaudeAnthropicTranscript({ enabled: true, tabId: TAB, agentSessionId: AGENT_SESSION, epoch: EPOCH, orcaRowCount: 3, orcaStatus: 'ready' }))
  return null
}

async function settle() {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

const last = () => seen[seen.length - 1]!
const at = (raw: Record<string, unknown>, iso: string) => ({ ...raw, created_at: iso })
const prompt = (uuid: string, iso: string) => at(event({ type: 'user', uuid, session_id: SESSION_A, parent_tool_use_id: null, message: { role: 'user', content: 'Fix the parser' } }), iso)
const toolCall = (uuid: string, iso: string) =>
  at(event({ type: 'assistant', uuid, session_id: SESSION_A, parent_tool_use_id: null, message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: `toolu_${uuid}`, name: 'Bash', input: { command: 'ls' } }] } }), iso)
const tasks = (uuid: string, ids: string[]) => event({ session_id: SESSION_A, subtype: 'background_tasks_changed', tasks: ids.map((id) => ({ task_id: id, task_type: 'local_bash' })), type: 'system', uuid })
const result = (uuid: string) =>
  event({ type: 'result', subtype: 'success', uuid, session_id: SESSION_A, duration_api_ms: 1, duration_ms: 1, is_error: false, modelUsage: {}, num_turns: 1, permission_denials: [], result: 'ok', stop_reason: 'end_turn', terminal_reason: null, total_cost_usd: 0, usage: {} })

function deps(history: unknown[], frames: string[]): CcrLinkDeps {
  const fetch: CcrFetch = async () => reply(200, eventsReply(history))
  return {
    fetch,
    streamFetch: streamFetch(() => ({ status: 200, chunks: sseBody(frames), hold: true })).fetch,
    auth: async () => ({ token: 't', organizationUuid: 'o' }),
    keep: (key) => `file:///${encodeURIComponent(key)}`,
    log: () => undefined
  }
}

beforeEach(() => {
  seen.length = 0
  resetCcrLinksForTests()
  resetCcrTranscriptsForTests()
  resetCcrCacheForTests()
  resetCcrMatchOutcomesForTests()
  setCcrLinkTimerForTests(() => () => undefined)
  setAnthropicSignInReaderForTests(async () => 1)
  setCcrMapping(TAB, SESSION_A, EPOCH, ACCOUNT, AGENT_SESSION)
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  resetCcrLinksForTests()
  setAnthropicSignInReaderForTests(null)
})

async function mount() {
  await act(async () => {
    renderer = create(createElement(Probe))
  })
  await settle()
}

describe('a Claude tab’s live state comes from Anthropic’s stream', () => {
  it('a turn streaming in is working, with the running tasks counted and the stream live', async () => {
    const history = [prompt('u1', '2026-10-15T12:29:33Z')]
    const frames = [sseFrame('client_event', tasks('t1', ['b1', 'b2'])), sseFrame('client_event', toolCall('a1', '2026-10-15T12:29:40Z'))]
    setCcrLinkDepsLoader(async () => deps(history, frames))
    await mount()
    expect(last().linkPhase).toBe('live')
    expect(last().live).toMatchObject({ working: true, runningTasks: 2, turnStartedAt: Date.parse('2026-10-15T12:29:33Z') })
  })

  it('the result event ends it: idle', async () => {
    setCcrLinkDepsLoader(async () => deps([prompt('u1', '2026-10-15T12:29:33Z')], [sseFrame('client_event', result('r1'))]))
    await mount()
    expect(last().live?.working).toBe(false)
  })

  it('a thinking block opening on the ephemeral stream reads as thinking, the text block after it not', async () => {
    const history = [prompt('u1', '2026-10-15T12:29:33Z'), toolCall('a1', '2026-10-15T12:29:40Z')]
    const partial = (inner: Record<string, unknown>) => ({ event_type: 'stream_event', payload: { type: 'stream_event', event: inner, parent_tool_use_id: null, uuid: 'p1', session_id: SESSION_A } })
    setCcrLinkDepsLoader(async () => deps(history, [sseFrame('ephemeral_event', partial({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }))]))
    await mount()
    expect(last().live?.thinking).toBe(true)
  })

  it('session_update disconnected: the session is not working', async () => {
    setCcrLinkDepsLoader(async () => deps([prompt('u1', '2026-10-15T12:29:33Z')], [sseFrame('session_update', { connection_status: 'disconnected' })]))
    await mount()
    expect(last().connectionStatus).toBe('disconnected')
    expect(last().live?.working).toBe(false)
  })

  // The failure path: a warm start from the kept copy, which holds rows and never a `result`.
  it('a finished turn read back from the phone’s kept copy is not working', async () => {
    const kept = [prompt('u1', '2026-10-15T09:00:00Z'), toolCall('a1', '2026-10-15T09:00:05Z')].map((raw) => parseCcrEvent(raw)!)
    writeCcrTranscript({ accountId: ACCOUNT, sessionId: SESSION_A, events: kept, lastSequenceNum: kept[1]!.sequenceNum!, olderCursor: null, hasOlder: false })
    await flushCcrTranscriptsForTests()
    setCcrLinkDepsLoader(async () => deps([], [sseFrame('client_event', tasks('t1', []))]))
    await mount()
    expect(last().linkPhase).toBe('live')
    expect(last().live).toMatchObject({ working: false, runningTasks: 0 })
  })
})
