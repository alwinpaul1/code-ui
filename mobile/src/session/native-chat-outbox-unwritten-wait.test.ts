import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  changeNativeChatOutbox,
  resetNativeChatOutboxForTests,
  type NativeChatOutboxEntry
} from '../storage/native-chat-outbox'
import type { RpcClient } from '../transport/rpc-client'
import { createOutboxDrainer } from './native-chat-outbox-drainer'
import { OUTBOX_TERMINAL_CONFIRM_WAIT_MS } from './native-chat-outbox-recovery-plan'
import { outboxTerminalConfirmedAt } from './native-chat-outbox-drain-plan'

const CREATED = 1_000_000

function entry(overrides: Partial<NativeChatOutboxEntry> = {}): NativeChatOutboxEntry {
  return {
    id: 'send-1',
    draftKey: 'host\0wt\0tab',
    pendingKey: 'host\0wt\0tab\0sess',
    text: 'thanks',
    normalizedText: 'thanks',
    baselineOccurrences: 0,
    baselineTailMessageId: null,
    baselineResolved: true,
    createdAt: CREATED,
    operationId: 'op',
    autoAttempts: 0,
    route: {
      hostId: 'host',
      worktreeId: 'wt',
      tabId: 'tab',
      lane: 'terminal',
      agent: 'claude',
      sessionId: 'sess',
      terminal: 'term',
      transcriptPath: null
    },
    ...overrides
  }
}

beforeEach(() => {
  resetNativeChatOutboxForTests()
})

// The confirm wait (docs/mobile-chat-outbox.md) keeps a send whose acknowledgement was lost from
// being typed again before its row has landed. An entry that was handed to the outbox before
// anything was typed (`unwritten`, no automatic send started yet) has no send in flight, and
// outboxEntryLanding already says nothing of it can have landed. A reply typed into a notification
// is such an entry: waiting 20 s to type it is a wait for a row that cannot exist.
describe('when a terminal entry that was never typed may be sent', () => {
  it('is at once, with no confirm wait', () => {
    expect(outboxTerminalConfirmedAt(entry({ unwritten: true }))).toBe(CREATED)
  })

  it('still runs the wait from the last send once an automatic send of it has started', () => {
    expect(outboxTerminalConfirmedAt(entry({ unwritten: true, lastAttemptAt: CREATED + 5_000 }))).toBe(
      CREATED + 5_000 + OUTBOX_TERMINAL_CONFIRM_WAIT_MS
    )
  })

  it('still runs the wait for an entry that is not marked unwritten (a composer send)', () => {
    expect(outboxTerminalConfirmedAt(entry())).toBe(CREATED + OUTBOX_TERMINAL_CONFIRM_WAIT_MS)
  })

  it('is what the drainer does: one second after the press, an unwritten entry is sent', async () => {
    await changeNativeChatOutbox((current) => [...current, entry({ unwritten: true })])
    const send = vi.fn(async () => 'accepted' as const)
    const drainer = createOutboxDrainer({
      now: () => CREATED + 1_000,
      connectedClient: () => ({ getState: () => 'connected' }) as unknown as RpcClient,
      observe: async () => ({ kind: 'clear', terminal: 'term' }),
      send,
      setTimer: () => () => undefined,
      log: () => undefined
    })
    drainer.kick()
    await drainer.idle()
    drainer.stop()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('is what the drainer does for a composer send too: one second after the press, it waits', async () => {
    await changeNativeChatOutbox((current) => [...current, entry()])
    const send = vi.fn(async () => 'accepted' as const)
    const drainer = createOutboxDrainer({
      now: () => CREATED + 1_000,
      connectedClient: () => ({ getState: () => 'connected' }) as unknown as RpcClient,
      observe: async () => ({ kind: 'clear', terminal: 'term' }),
      send,
      setTimer: () => () => undefined,
      log: () => undefined
    })
    drainer.kick()
    await drainer.idle()
    drainer.stop()
    expect(send).not.toHaveBeenCalled()
  })
})
