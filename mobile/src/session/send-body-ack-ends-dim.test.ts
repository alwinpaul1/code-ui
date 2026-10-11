// Where the phone's ack is: the desktop answering the body write (`terminal.send`). A bubble's dim
// ends there (pending-dim-ends-at-send-ack.test.ts drives the composer send end to end). Here:
// writeChatSend says so before Claude's check, and only for a write the desktop took; and a
// message the app-wide drainer types is marked the same way, so its bubble, where its chat is
// shown, comes out of the dim too.
//
// The desk's screen is Claude Code 2.1.296 at 46 columns, captured 2026-10-09
// (send-exit-outbox-terminal.test.ts, native-chat-outbox-headless-send.test.ts).

import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bodyWrite = vi.hoisted(() => ({ outcome: 'accepted' as 'accepted' | 'rejected' | 'unknown', real: true }))
vi.mock('./mobile-native-chat-send', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mobile-native-chat-send')>()
  return {
    ...actual,
    sendMobileNativeChatMessageWithOutcome: async (...args: Parameters<typeof actual.sendMobileNativeChatMessageWithOutcome>) =>
      bodyWrite.real ? actual.sendMobileNativeChatMessageWithOutcome(...args) : bodyWrite.outcome
  }
})

import {
  changeNativeChatOutbox,
  nativeChatOutboxEntries,
  nativeChatOutboxWritesSettled,
  resetNativeChatOutboxForTests,
  type NativeChatOutboxEntry
} from '../storage/native-chat-outbox'
import type { RpcClient } from '../transport/rpc-client'
import { ok } from './use-mobile-native-chat-image-attachments.test-support'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { writeChatSend } from './mobile-native-chat-send-write'
import { sendTerminalOutboxEntry } from './native-chat-outbox-headless'
import { resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { outboxDeliveryOf } from './use-native-chat-outbox-recovery'

const RULE = '─'.repeat(46)
const STATUS = ['                                          [-]', '  Haiku 5.5 medium │ ◔ — ', '  ◷ 5h 4% │ Sat 3:20 AM  ', '  ▦ 7d 45% │ Wed 7:00 PM ']
const FOOTER = '  ⏵⏵ auto mode on (shift+tab to cycle)'
const EMPTY_INPUT = [...STATUS, RULE, '❯ ', RULE, FOOTER]
const TEXT = 'run the whole suite again'

/** A desk whose input stays empty and whose `terminal.send` answers `accepted`. */
function desk(): RpcClient {
  return {
    getState: () => 'connected',
    subscribe: vi.fn(() => () => {}),
    sendRequest: vi.fn(async (method: string) =>
      method === 'terminal.read'
        ? ok('r', { terminal: { source: 'screen', tail: EMPTY_INPUT, draft: '' } })
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

beforeEach(() => {
  bodyWrite.real = true
  bodyWrite.outcome = 'accepted'
  resetNativeChatOutboxForTests()
  resetOutboxSendsForTests()
})
afterEach(async () => {
  vi.useRealTimers()
  resetMobileNativeChatTerminalWritesForTests()
  resetNativeChatOutboxForTests()
  resetOutboxSendsForTests()
  await AsyncStorage.clear()
})

function write(agent: 'claude' | 'codex', onBodyAcked: () => void) {
  return writeChatSend({
    agent,
    client: desk(),
    terminal: 'term-1',
    text: TEXT,
    hasImages: false,
    syncComposer: true,
    classification: 'chat',
    typesCodexCommand: false,
    seed: null,
    residue: null,
    deadline: Date.now() + 15_000,
    deviceToken: null,
    receipts: () => [],
    onBodyAcked
  })
}

describe('the ack a send’s write gets from the desktop', () => {
  for (const agent of ['claude', 'codex'] as const) {
    it(`is reported once the desktop took the body (${agent})`, async () => {
      vi.useFakeTimers()
      const onBodyAcked = vi.fn()
      const sending = write(agent, onBodyAcked)
      await vi.runAllTimersAsync()
      await sending
      expect(onBodyAcked).toHaveBeenCalledOnce()
    })

    for (const outcome of ['rejected', 'unknown'] as const) {
      it(`is not reported when the desktop answered the body ${outcome} (${agent})`, async () => {
        vi.useFakeTimers()
        bodyWrite.real = false
        bodyWrite.outcome = outcome
        const onBodyAcked = vi.fn()
        const sending = write(agent, onBodyAcked)
        await vi.runAllTimersAsync()
        expect(await sending).toEqual({ kind: 'written', outcome })
        expect(onBodyAcked).not.toHaveBeenCalled()
      })
    }
  }

  it('comes before Claude’s check, which may still be looking', async () => {
    vi.useFakeTimers()
    const onBodyAcked = vi.fn()
    let settled = false
    const sending = write('claude', onBodyAcked).then((result) => {
      settled = true
      return result
    })
    // Long enough for the clear and the body over the fake wire, not for the check's looks.
    for (let step = 0; step < 20 && onBodyAcked.mock.calls.length === 0; step += 1) {
      await vi.advanceTimersByTimeAsync(10)
    }
    expect(onBodyAcked).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    await vi.runAllTimersAsync()
    await sending
  })
})

describe('a message the app-wide drainer typed', () => {
  it('is drawn as taken once the desktop acked its write, still waiting for Claude’s record', async () => {
    vi.useFakeTimers()
    await changeNativeChatOutbox(() => [entry])
    const sending = sendTerminalOutboxEntry(desk(), entry, 'term-1')
    await vi.runAllTimersAsync()
    await sending
    await nativeChatOutboxWritesSettled()
    const after = nativeChatOutboxEntries().find((candidate) => candidate.id === entry.id)
    expect(after).toBeDefined()
    expect(outboxDeliveryOf(after!)).toBe('taken')
  })

  it('stays on its way when the desktop never answered its write', async () => {
    vi.useFakeTimers()
    bodyWrite.real = false
    bodyWrite.outcome = 'unknown'
    await changeNativeChatOutbox(() => [entry])
    const sending = sendTerminalOutboxEntry(desk(), entry, 'term-1')
    await vi.runAllTimersAsync()
    await sending
    await nativeChatOutboxWritesSettled()
    const after = nativeChatOutboxEntries().find((candidate) => candidate.id === entry.id)
    expect(outboxDeliveryOf(after!)).toBe('sending')
  })
})
