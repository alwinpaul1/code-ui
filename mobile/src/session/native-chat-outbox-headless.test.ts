// What the app-wide drainer reads from the desktop before it types a terminal entry again, and how
// it sends a structured one, with no chat on screen (native-chat-outbox-headless.ts). Every read
// that fails is "not now", never "not there": a terminal resend with no operation id is a second
// post, so it needs the evidence first.
//
// Claude screens: Claude Code 2.1.296 at 46 columns, captured 2026-10-09 (shared with
// send-exit-outbox-terminal.test.ts), and Claude Code 2.1.283's permission prompt. Codex screens: Codex 0.158.0, real bytes
// (fixtures/codex-composer-screens.ts).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { NativeChatOutboxEntry } from '../storage/native-chat-outbox'
import type { RpcClient } from '../transport/rpc-client'
import { ok } from './use-mobile-native-chat-image-attachments.test-support'
import { IDLE_AFTER_TURN_0158, WORKING_0158, withoutBlankRows } from './fixtures/codex-composer-screens'
import { observeTerminalOutboxEntry, promptIsReceiptOf } from './native-chat-outbox-headless'
import { sendSessionOutboxEntry } from './native-chat-outbox-session-send'

const RULE = '─'.repeat(46)
const STATUS = [
  '                                          [-]',
  '  Haiku 5.5 medium │ ◔ — ',
  '  ◷ 5h 4% │ Sat 3:20 AM  ',
  '  ▦ 7d 45% │ Wed 7:00 PM '
]
const FOOTER = '  ⏵⏵ auto mode on (shift+tab to cycle)'
const CLAUDE_IDLE = [...STATUS, RULE, '❯ ', RULE, FOOTER]
/** Claude Code 2.1.283's Bash permission prompt over the composer, captured on the desktop
 *  2026-09-27 (shared with hud-observation-queue-readable.test.ts). */
const CLAUDE_PERMISSION = readFileSync(
  fileURLToPath(new URL('./fixtures/claude-screen-subagent-bash-permission-2.1.283.txt', import.meta.url)),
  'utf8'
)
  .split('\n')
  .filter((line) => !line.startsWith('# '))

const TEXT = 'run the tests again'
const NOW = Date.now()

function row(id: string, role: 'user' | 'assistant', text: string): NativeChatMessage {
  return { id, role, blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}

function entry(agent: 'claude' | 'codex', overrides: Partial<NativeChatOutboxEntry> = {}): NativeChatOutboxEntry {
  return {
    id: 'send-1',
    draftKey: 'h\0w\0tab-a',
    pendingKey: 'h\0w\0tab-a\0session-1',
    text: TEXT,
    normalizedText: TEXT,
    baselineOccurrences: 0,
    baselineTailMessageId: 'a-0',
    baselineResolved: true,
    createdAt: NOW - 60_000,
    operationId: 'op-1',
    autoAttempts: 0,
    route: {
      hostId: 'h',
      worktreeId: 'w',
      tabId: 'tab-a',
      lane: 'terminal',
      agent,
      sessionId: 'session-1',
      terminal: 'term-1',
      transcriptPath: null
    },
    ...overrides
  }
}

type Desk = {
  agent: 'claude' | 'codex'
  screen: string[] | null
  transcript: NativeChatMessage[] | null
  status: Record<string, unknown> | null
  tabs: 'ok' | 'fails' | 'gone'
  /** What Orca publishes as the desk's input line. */
  draft?: string
}

function client(desk: Desk): RpcClient {
  return {
    getState: () => 'connected',
    subscribe: vi.fn((method: string, _params: unknown, onData: (frame: unknown) => void) => {
      if (method === 'nativeChat.subscribe' && desk.transcript) {
        const rows = desk.transcript
        setTimeout(() => onData({ type: 'snapshot', messages: rows }), 5)
      } else if (method === 'nativeChat.subscribe') {
        setTimeout(() => onData({ type: 'error', message: 'no transcript' }), 5)
      }
      return () => {}
    }),
    sendRequest: vi.fn(async (method: string) => {
      if (method === 'session.tabs.list') {
        if (desk.tabs === 'fails') {
          throw new Error('timed out')
        }
        return ok('t', {
          worktree: 'w',
          snapshotVersion: 1,
          activeTabId: 'tab-b',
          activeTabType: 'terminal',
          tabs:
            desk.tabs === 'gone'
              ? []
              : [
                  {
                    type: 'terminal',
                    id: 'tab-a',
                    title: desk.agent,
                    terminal: 'term-1',
                    isActive: false,
                    agentStatus: desk.status
                  }
                ]
        })
      }
      if (method === 'terminal.read') {
        return desk.screen ? ok('r', { terminal: { source: 'screen', tail: desk.screen, draft: desk.draft ?? '' } }) : ok('r', null)
      }
      return ok('x', null)
    })
  } as unknown as RpcClient
}

function idleStatus(agent: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: 'done',
    prompt: 'earlier',
    updatedAt: NOW - 120_000,
    stateStartedAt: NOW - 120_000,
    paneKey: 'tab-a:leaf',
    agentType: agent,
    stateHistory: [],
    providerSession: { key: agent, id: 'session-1' },
    ...overrides
  }
}

const transcript = (): NativeChatMessage[] => [row('u-0', 'user', 'earlier'), row('a-0', 'assistant', 'done')]

async function observe(desk: Desk, overrides: Partial<NativeChatOutboxEntry> = {}) {
  vi.useFakeTimers()
  const looking = observeTerminalOutboxEntry(client(desk), entry(desk.agent, overrides))
  await vi.advanceTimersByTimeAsync(20_000)
  return looking
}

afterEach(() => {
  vi.useRealTimers()
})

describe('observeTerminalOutboxEntry', () => {
  const claude = (overrides: Partial<Desk> = {}): Desk => ({
    agent: 'claude',
    screen: CLAUDE_IDLE,
    transcript: transcript(),
    status: idleStatus('claude'),
    tabs: 'ok',
    ...overrides
  })
  const codex = (overrides: Partial<Desk> = {}): Desk => ({
    agent: 'codex',
    screen: withoutBlankRows(IDLE_AFTER_TURN_0158),
    transcript: transcript(),
    status: idleStatus('codex'),
    tabs: 'ok',
    ...overrides
  })

  it('clears a Claude entry with no row, no receipt, an idle agent and an empty box', async () => {
    expect(await observe(claude())).toEqual({ kind: 'clear', terminal: 'term-1' })
  })

  it('clears a Codex entry the same way, read off its own composer', async () => {
    expect(await observe(codex())).toEqual({ kind: 'clear', terminal: 'term-1' })
  })

  it('waits while Codex says it works', async () => {
    expect(await observe(codex({ screen: withoutBlankRows(WORKING_0158), status: idleStatus('codex', { state: 'working' }) }))).toEqual({
      kind: 'busy'
    })
  })

  it('finds the row of a message that arrived, after its boundary', async () => {
    expect(await observe(claude({ transcript: [...transcript(), row('u-1', 'user', TEXT)] }))).toEqual({ kind: 'landed' })
  })

  it('cannot tell when its boundary is not in the read, and says so instead of guessing', async () => {
    expect(await observe(claude({ transcript: [row('u-9', 'user', 'other'), row('a-9', 'assistant', 'x')] }))).toEqual({
      kind: 'unsure'
    })
  })

  it('waits under a permission dialog', async () => {
    expect(await observe(claude({ screen: CLAUDE_PERMISSION }))).toEqual({ kind: 'busy' })
  })

  it('waits when a read fails: the tab list, the transcript, or the screen', async () => {
    expect(await observe(claude({ tabs: 'fails' }))).toEqual({ kind: 'busy' })
    expect(await observe(claude({ transcript: null }))).toEqual({ kind: 'busy' })
    expect(await observe(claude({ screen: null }))).toEqual({ kind: 'busy' })
  })

  it('reports a tab that is gone', async () => {
    expect(await observe(claude({ tabs: 'gone' }))).toEqual({ kind: 'tab-gone' })
  })

  it('reports a tab whose own agent moved to another session, but not a nested agent’s session', async () => {
    expect(await observe(claude({ status: idleStatus('claude', { providerSession: { key: 'claude', id: 'session-2' } }) }))).toEqual({
      kind: 'session-changed'
    })
    expect(
      await observe(claude({ status: idleStatus('claude', { agentType: 'grok', providerSession: { key: 'grok', id: 'g-1' } }) }))
    ).toEqual({ kind: 'clear', terminal: 'term-1' })
  })

})

// Found by the Opus review of 4efae5746: `updatedAt` is the status's delivery clock (every tool
// ping and every relay reconnect restamps it), not when the prompt came, so a repeat of the last
// prompt ("continue", "yes") read as delivered and was retired unsent.
describe('the tab\u2019s hook prompt as a receipt', () => {
  const claudeDesk = (status: Record<string, unknown>): Desk => ({
    agent: 'claude',
    screen: CLAUDE_IDLE,
    transcript: transcript(),
    status,
    tabs: 'ok'
  })

  it('does not take the prompt the tab already had when the message left, however fresh its stamp', async () => {
    const repeat = { route: { ...entry('claude').route!, promptBefore: TEXT } }
    expect(await observe(claudeDesk(idleStatus('claude', { prompt: TEXT, updatedAt: NOW })), repeat)).toEqual({
      kind: 'clear',
      terminal: 'term-1'
    })
    expect(
      await observe(
        claudeDesk(idleStatus('claude', { stateHistory: [{ state: 'done', prompt: TEXT, startedAt: NOW }] })),
        repeat
      )
    ).toEqual({ kind: 'clear', terminal: 'term-1' })
  })

  it('does not trust a prompt at all when it does not know what the tab had before', async () => {
    expect(await observe(claudeDesk(idleStatus('claude', { prompt: TEXT, updatedAt: NOW })))).toEqual({
      kind: 'clear',
      terminal: 'term-1'
    })
  })

  it('takes a prompt that changed to its words after it left', async () => {
    expect(
      await observe(claudeDesk(idleStatus('claude', { prompt: TEXT, updatedAt: NOW })), {
        route: { ...entry('claude').route!, promptBefore: 'something earlier' }
      })
    ).toEqual({ kind: 'landed' })
  })
})

// Re-review of 978156bf9: chips on the desk's line are only an entry's own when it carries
// that many photos; a screenshot pasted at the desk is someone's input.
describe('image chips on the desk\u2019s input line', () => {
  const desk = (draft: string): Desk => ({
    agent: 'claude',
    screen: CLAUDE_IDLE,
    transcript: transcript(),
    status: idleStatus('claude'),
    tabs: 'ok',
    draft
  })

  it('are not a text entry\u2019s own', async () => {
    expect(await observe(desk('[Image #1]'))).toEqual({ kind: 'busy' })
  })

  it('are not a one-photo entry\u2019s own when there are two', async () => {
    const photo = { hasAttachments: true as const, attachments: [{ path: '/tmp/a.png', previewUri: 'file:///a.jpg' }] }
    expect(await observe(desk('[Image #1] [Image #2]'), photo)).toEqual({ kind: 'busy' })
  })
})

describe('promptIsReceiptOf', () => {
  const knowing = (before: string | null, overrides: Partial<NativeChatOutboxEntry> = {}) =>
    entry('claude', { ...overrides, route: { ...entry('claude').route!, promptBefore: before } })

  it('matches its words, a cut copy of long words, and nothing empty or already there', () => {
    const long = 'x'.repeat(260)
    expect(promptIsReceiptOf(knowing('earlier'), TEXT)).toBe(true)
    expect(promptIsReceiptOf(knowing(null), TEXT)).toBe(true)
    expect(promptIsReceiptOf(knowing('earlier', { text: long, normalizedText: long }), 'x'.repeat(199))).toBe(true)
    expect(promptIsReceiptOf(knowing('earlier', { text: long, normalizedText: long }), 'x'.repeat(50))).toBe(false)
    expect(promptIsReceiptOf(knowing(TEXT), TEXT)).toBe(false)
    expect(promptIsReceiptOf(knowing('earlier'), '')).toBe(false)
    expect(promptIsReceiptOf(knowing('earlier', { text: '', normalizedText: '' }), '')).toBe(false)
    expect(promptIsReceiptOf(entry('claude'), TEXT)).toBe(false)
  })
})

describe('sendSessionOutboxEntry', () => {
  it('sends under the entry’s own operation id, with its uploaded paths, and lets the session go', async () => {
    const calls: { method: string; params: Record<string, unknown> }[] = []
    const desk = {
      getState: () => 'connected',
      subscribe: vi.fn((_method: string, _params: unknown, onData: (frame: unknown) => void) => {
        setTimeout(() => onData({ type: 'snapshot', fence: 7 }), 1)
        return () => {}
      }),
      sendRequest: vi.fn(async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params })
        if (method === 'agentSession.send') {
          return ok('s', { ok: true, value: { submission: { dispatchState: 'accepted' } } })
        }
        return ok('x', {})
      })
    } as unknown as RpcClient
    const structured = entry('claude', {
      operationId: '1800000000000-abcdefabcdefabcdefabcdefabcdefab',
      hasAttachments: true,
      attachments: [{ path: '/tmp/p.png', previewUri: 'file:///p.jpg' }],
      route: { ...entry('claude').route!, lane: 'session', terminal: null }
    })
    expect(await sendSessionOutboxEntry(desk, structured)).toBe('accepted')
    const send = calls.find((call) => call.method === 'agentSession.send')!
    expect((send.params.envelope as Record<string, unknown>).clientOperationId).toBe(structured.operationId)
    expect((send.params.envelope as Record<string, unknown>).expectedRuntimeFence).toBe(7)
    expect(JSON.stringify(send.params.body)).toContain('/tmp/p.png')
    await vi.waitFor(() => expect(calls.map((call) => call.method)).toContain('agentSession.release'))
    expect(calls.map((call) => call.method)[0]).toBe('agentSession.hold')
  })

  // Re-review of 978156bf9: a host that answers "no such session" is a refusal that counts,
  // or an entry for a closed session said "Sending…" for a day; only a link that failed is free.
  it('sends nothing and counts a try when the host refuses to hold the session', async () => {
    const methods: string[] = []
    const desk = {
      getState: () => 'connected',
      subscribe: vi.fn(() => () => {}),
      sendRequest: vi.fn(async (method: string) => {
        methods.push(method)
        return { id: 'h', ok: false, error: { code: 'agent_session_not_found', message: 'gone' }, _meta: { runtimeId: 'r' } }
      })
    } as unknown as RpcClient
    expect(await sendSessionOutboxEntry(desk, entry('claude', { route: { ...entry('claude').route!, lane: 'session' } }))).toBe(
      'rejected'
    )
    expect(methods).toEqual(['agentSession.hold'])
  })

  it('sends nothing and costs no try when the link fails under the hold', async () => {
    const desk = {
      getState: () => 'connected',
      subscribe: vi.fn(() => () => {}),
      sendRequest: vi.fn(async () => {
        throw new Error('Connection retry limit reached')
      })
    } as unknown as RpcClient
    expect(await sendSessionOutboxEntry(desk, entry('claude', { route: { ...entry('claude').route!, lane: 'session' } }))).toBe(
      'not-now'
    )
  })

  it('counts a try when the session feed answers with an error instead of a fence', async () => {
    const desk = {
      getState: () => 'connected',
      subscribe: vi.fn((_method: string, _params: unknown, onData: (frame: unknown) => void) => {
        setTimeout(() => onData({ type: 'error', message: 'agent_session_not_found' }), 1)
        return () => {}
      }),
      sendRequest: vi.fn(async () => ok('x', {}))
    } as unknown as RpcClient
    expect(await sendSessionOutboxEntry(desk, entry('claude', { route: { ...entry('claude').route!, lane: 'session' } }))).toBe(
      'rejected'
    )
  })
})
