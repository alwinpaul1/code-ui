// The structured-session half of the 2026-10-10 report ("if I send and then immediately close the
// app or exit the app, the message isn't sent and not even in the input"), with the user's call
// that the message must be sent anyway, the way chat apps do it: an outbox entry per press, sent
// again after the process died, under the SAME client operation id on every automatic attempt so
// the host's ledger can only ever answer a retry with the first attempt's result. A new press by
// the user is a new message under a new id (Orca #26392).
//
// Drives the REAL draft store, the REAL structured send bridge and the REAL outbox recovery; the
// session's own send is a host double with the ledger the host keeps (one delivery per id).

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { useMobileStructuredNativeChatSendBridge } from './use-mobile-structured-native-chat-send-bridge'
import { useMobileNativeChatOutbox } from './use-mobile-native-chat-outbox'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { resetLiveNativeChatDraftsForTests } from './mobile-native-chat-live-drafts'
import { nativeChatOutboxEntries, resetNativeChatOutboxForTests } from '../storage/native-chat-outbox'
import { resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { resetNativeChatSendTimingForTests } from './native-chat-send-timing'
import { OUTBOX_ECHO_PREFIX } from './mobile-native-chat-outbox-drafts'

const TEXT = 'run the migration again'
const connectedClient = { getState: () => 'connected', notifyForeground: vi.fn() } as unknown as RpcClient

type Host = {
  /** Every request: its words and the operation id it carried. */
  requests: { text: string; operationId: string | undefined }[]
  /** Messages the agent actually got: one per operation id, whatever the retries. */
  delivered: string[]
  /** How the next request ends. `hang` never answers: the process dies with it out. */
  next: 'accepted' | 'hang'
  send: (text: string, images?: string[], deadline?: number, attachments?: unknown, operationId?: string) => Promise<MobileNativeChatSendOutcome>
}

function host(next: Host['next'] = 'accepted', ledger = new Set<string>()): Host {
  const state: Host = {
    requests: [],
    delivered: [],
    next,
    send: async (text, _images, _deadline, _attachments, operationId) => {
      state.requests.push({ text, operationId })
      // The host's ledger: a second request under a recorded id is answered from it.
      if (operationId && !ledger.has(operationId)) {
        ledger.add(operationId)
        state.delivered.push(text)
      }
      if (state.next === 'hang') {
        return new Promise<MobileNativeChatSendOutcome>(() => {})
      }
      return 'accepted'
    }
  }
  return state
}

describe('a structured-session message the app was closed under', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
  let bridge: ReturnType<typeof useMobileStructuredNativeChatSendBridge> | null = null
  let outbox: ReturnType<typeof useMobileNativeChatOutbox> | null = null
  const errors: string[] = []

  beforeEach(() => {
    errors.length = 0
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    resetNativeChatSendTimingForTests()
  })
  afterEach(async () => {
    vi.useRealTimers()
    act(() => renderer?.unmount())
    renderer = null
    resetLiveNativeChatDraftsForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    await clearNativeChatDraftStores()
  })

  function mount(desk: Host): void {
    function ChatScreen(): null {
      drafts = useMobileNativeChatDrafts({
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-s',
        sessionId: 'session-s',
        messages: [],
        transcriptSettled: true
      })
      bridge = useMobileStructuredNativeChatSendBridge({
        agent: 'claude',
        sendStructured: desk.send,
        sendConditions: { client: connectedClient, sendable: true },
        captureSendOrigin: drafts.captureSendOrigin,
        clearDraftForSend: drafts.clearDraftForSend,
        acceptSend: drafts.acceptSend,
        holdUnconfirmedSend: drafts.holdUnconfirmedSend,
        restoreRejectedDraft: drafts.restoreRejectedDraft,
        showSendingEcho: drafts.showSendingEcho,
        onSendError: (message) => errors.push(message)
      })
      outbox = useMobileNativeChatOutbox({
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-s',
        sessionId: 'session-s',
        showNativeChat: true,
        structured: true,
        terminalChat: false,
        messages: [],
        transcriptSettled: true,
        receipts: [],
        inputSendable: true,
        agentWorking: true,
        promptUp: false,
        queuedCount: 0,
        composerText: drafts.composerText,
        setComposerText: drafts.setComposerText,
        sendTerminal: async () => 'rejected',
        sendStructured: (text) => bridge!.sendWithOutcome(text),
        showEcho: drafts.showOutboxEcho,
        removeEcho: drafts.removePending,
        onNotice: (message) => errors.push(message)
      })
      return null
    }
    act(() => {
      renderer = create(createElement(ChatScreen))
    })
  }

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  async function press(text: string): Promise<void> {
    await act(async () => {
      drafts!.setComposerText(text)
    })
    await act(async () => {
      void bridge!.sendWithOutcome(text)
      await vi.advanceTimersByTimeAsync(0)
    })
  }

  async function processRestart(): Promise<void> {
    await act(async () => {
      renderer?.unmount()
      await vi.advanceTimersByTimeAsync(0)
    })
    renderer = null
    resetLiveNativeChatDraftsForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    resetNativeChatSendTimingForTests()
  }

  it('sends it once on the next start, under the operation id of the press', async () => {
    vi.useFakeTimers()
    const first = host('hang', new Set())
    mount(first)
    await press(TEXT)
    expect(drafts!.composerText).toBe('')
    const pressedId = first.requests[0]?.operationId
    expect(pressedId).toEqual(expect.any(String))

    await processRestart()
    const desk = host('accepted')
    mount(desk)
    await advance(100)
    expect(drafts!.pending.filter((item) => item.id.startsWith(OUTBOX_ECHO_PREFIX)).map((item) => item.text)).toEqual([TEXT])
    await advance(3_000)
    // Accepted: the bubble stays, now an ordinary sent message waiting for its row.
    expect(outbox!.deliveries).toEqual({})

    expect(desk.requests).toEqual([{ text: TEXT, operationId: pressedId }])
    expect(errors).toEqual([])
    expect(nativeChatOutboxEntries()).toEqual([])
    await advance(60_000)
    expect(desk.requests).toHaveLength(1)
  })

  it('posts it once when the process dies again during the resend: the ledger answers the second attempt', async () => {
    vi.useFakeTimers()
    const ledger = new Set<string>()
    const first = host('hang', ledger)
    mount(first)
    await press(TEXT)
    await processRestart()
    // The resend reaches the host and the process dies before the answer.
    const second = host('hang', ledger)
    mount(second)
    await advance(3_000)
    expect(second.requests).toHaveLength(1)

    await processRestart()
    const third = host('accepted', ledger)
    mount(third)
    await advance(3_000)

    const ids = [...first.requests, ...second.requests, ...third.requests].map((request) => request.operationId)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(1)
    // Three requests across three processes, one message to the agent.
    expect([...first.delivered, ...second.delivered, ...third.delivered]).toEqual([TEXT])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('draws the message as "Sending…" the moment the box empties, before the host answers', async () => {
    vi.useFakeTimers()
    mount(host('hang'))
    await press(TEXT)

    expect(drafts!.composerText).toBe('')
    const bubbles = drafts!.pending.filter((item) => item.id.startsWith(OUTBOX_ECHO_PREFIX))
    expect(bubbles.map((item) => item.text)).toEqual([TEXT])
    expect(outbox!.deliveries[bubbles[0]!.id]).toBe('sending')
  })

  it('gives a new press of the same words a new operation id (#26392)', async () => {
    vi.useFakeTimers()
    const desk = host('accepted')
    mount(desk)
    await press(TEXT)
    await press(TEXT)

    expect(desk.requests).toHaveLength(2)
    expect(desk.requests[0]!.operationId).not.toBe(desk.requests[1]!.operationId)
    expect(desk.delivered).toEqual([TEXT, TEXT])
  })
})
