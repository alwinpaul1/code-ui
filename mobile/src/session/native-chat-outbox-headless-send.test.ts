// How a drainer terminal send that stopped is counted (native-chat-outbox-headless.ts). A stop
// before anything was typed is 'not-now' and costs the entry no attempt. But a clear that cannot
// take the message's OWN leftover (more than its ~31 rows) never will, and counting that as free
// kept an entry trying for a day (re-review of 978156bf9): it is 'rejected', which counts.
//
// writeChatSend is stubbed to the stop it reports; the screen is Claude Code 2.1.296 at 46
// columns, captured 2026-10-09 (send-exit-outbox-terminal.test.ts).

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatOutboxEntry } from '../storage/native-chat-outbox'
import type { RpcClient } from '../transport/rpc-client'
import { ok } from './use-mobile-native-chat-image-attachments.test-support'
import { INPUT_STILL_HOLDS_TEXT } from './mobile-native-chat-verified-clear'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'

const written = vi.hoisted(() => ({ message: '' }))
vi.mock('./mobile-native-chat-send-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mobile-native-chat-send-write')>()
  return { ...actual, writeChatSend: async () => ({ kind: 'stopped', message: written.message }) }
})

const { sendTerminalOutboxEntry } = await import('./native-chat-outbox-headless')

const RULE = '─'.repeat(46)
const STATUS = ['                                          [-]', '  Haiku 5.5 medium │ ◔ — ', '  ◷ 5h 4% │ Sat 3:20 AM  ', '  ▦ 7d 45% │ Wed 7:00 PM ']
const FOOTER = '  ⏵⏵ auto mode on (shift+tab to cycle)'
const holding = (text: string): string[] => [...STATUS, RULE, `❯ ${text}`, RULE, FOOTER]
const TEXT = 'run the whole suite again'

function desk(draft: string): RpcClient {
  return {
    getState: () => 'connected',
    subscribe: vi.fn(() => () => {}),
    sendRequest: vi.fn(async (method: string) =>
      method === 'terminal.read'
        ? ok('r', { terminal: { source: 'screen', tail: holding(draft), draft } })
        : ok('s', { send: { accepted: true } })
    )
  } as unknown as RpcClient
}

const entry: NativeChatOutboxEntry = {
  id: 'send-1',
  draftKey: 'h\0w\0tab-a',
  pendingKey: 'h\0w\0tab-a\0session-1',
  text: TEXT,
  normalizedText: TEXT,
  baselineOccurrences: 0,
  baselineTailMessageId: null,
  baselineResolved: true,
  createdAt: Date.now(),
  operationId: 'op-1',
  autoAttempts: 1,
  route: { hostId: 'h', worktreeId: 'w', tabId: 'tab-a', lane: 'terminal', agent: 'claude', sessionId: 'session-1', terminal: 'term-1', transcriptPath: null }
}

afterEach(() => {
  resetMobileNativeChatTerminalWritesForTests()
})

describe('a drainer terminal send whose clear could not empty the line', () => {
  it('costs an attempt when the line held only its own leftover', async () => {
    written.message = INPUT_STILL_HOLDS_TEXT
    expect(await sendTerminalOutboxEntry(desk(TEXT), entry, 'term-1')).toBe('rejected')
  })

  it('costs nothing when the line was empty at the look (something else filled it)', async () => {
    written.message = INPUT_STILL_HOLDS_TEXT
    expect(await sendTerminalOutboxEntry(desk(''), entry, 'term-1')).toBe('not-now')
  })

  it('refuses before typing, at no cost, when someone else’s words are on the line', async () => {
    written.message = INPUT_STILL_HOLDS_TEXT
    expect(await sendTerminalOutboxEntry(desk('half a thought'), entry, 'term-1')).toBe('not-now')
  })
})
