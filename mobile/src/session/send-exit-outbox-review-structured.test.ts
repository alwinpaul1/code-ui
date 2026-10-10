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
import { resetNativeChatOutboxForTests } from '../storage/native-chat-outbox'
import { resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { resetNativeChatSendTimingForTests } from './native-chat-send-timing'
import { isStructuredAgentSessionComposerCommand } from '../../../src/shared/structured-agent-session-composer'

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

describe('outbox regressions found in review (2026-10-10) (structured)', () => {
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

  it('Retry on a "Not sent" bubble is a new press: a stuck ledger row cannot answer it (#26392)', async () => {
    vi.useFakeTimers()
    // The host's ledger keeps the first attempt's row UNRESOLVED: every request under that id is
    // answered from it ("unknown"), never delivered. A new id is delivered and accepted.
    const stuck = new Set<string>()
    const desk: Host = {
      requests: [],
      delivered: [],
      next: 'accepted',
      send: async (text, _images, _deadline, _attachments, operationId) => {
        desk.requests.push({ text, operationId })
        if (operationId === undefined || stuck.has(operationId) || stuck.size === 0) {
          if (operationId) {
            stuck.add(operationId)
          }
          return 'unknown'
        }
        desk.delivered.push(text)
        return 'accepted'
      }
    }
    mount(desk)
    await press(TEXT)
    const pressedId = desk.requests[0]!.operationId
    for (let i = 0; i < 15; i += 1) {
      await advance(10_000)
    }
    // Two automatic attempts, both answered from the stuck row; the bubble says "Not sent".
    expect(Object.values(outbox!.deliveries)).toEqual(['failed'])
    expect(desk.requests.every((request) => request.operationId === pressedId)).toBe(true)

    await act(async () => {
      outbox!.retry(Object.keys(outbox!.deliveries)[0]!)
    })
    for (let i = 0; i < 3; i += 1) {
      await advance(10_000)
    }
    // The user's Retry must be able to reach the agent.
    expect({ retryId: desk.requests.at(-1)!.operationId === pressedId ? 'same as the stuck press' : 'new', delivered: desk.delivered }).toEqual({
      retryId: 'new',
      delivered: [TEXT]
    })
  })

  it('draws no bubble for a recovered host command, which never gets a row', async () => {
    vi.useFakeTimers()
    const ledger = new Set<string>()
    expect(isStructuredAgentSessionComposerCommand('/compact', 'claude')).toBe(true)
    const first = host('hang', ledger)
    mount(first)
    await press('/compact')
    // The live send draws no bubble for a host command.
    expect(drafts!.pending).toEqual([])
    await processRestart()
    const desk = host('accepted', ledger)
    mount(desk)
    for (let i = 0; i < 6; i += 1) {
      await advance(10_000)
    }
    // A host command writes no row, so the outbox never holds one: nothing is sent again
    // after the restart, and no bubble is drawn that no row could ever retire.
    expect(first.requests.map((request) => request.text)).toEqual(['/compact'])
    expect(desk.requests).toEqual([])
    expect(drafts!.pending.map((item) => item.text)).toEqual([])
  })
})
