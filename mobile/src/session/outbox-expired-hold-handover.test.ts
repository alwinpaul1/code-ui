// What an unconfirmed send says when its hold runs out with the chat still on screen.
//
// Until 0.9.127 a send whose acknowledgement was lost was held for its row for 20 s of foreground
// time (mobile-native-chat-unconfirmed-hold.ts), and if none came it said "Delivery unconfirmed —
// check chat before retrying" and left the words out of the box, since they may well have arrived
// (0.9.118, 0.9.119). The 0.9.127 outbox hands an expired hold to the chat's recovery instead
// whenever one is mounted, and stops saying anything itself. That is right when the recovery can
// act on it. It found two holds it cannot act on, and both lost the old notice:
//
// - a photo send: the recovery never resends files, so it gave the words back with "the app closed
//   before it reached your desktop. Attach the files again", though the app never closed and the
//   photo may have arrived (re-attaching it then posts it twice), and it did the same when the
//   chat was merely closed under the held send and opened again in the same run;
// - a chat whose transcript is not a settled read: the recovery waits for one, so the bubble said
//   "Sending…" for good and nothing was ever said.
//
// Drives the REAL draft store, the REAL structured send bridge and the REAL outbox recovery.

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
import { resetAppForegroundClockForTests } from './app-foreground-clock'

const TEXT = 'what is in this screenshot'
const PHOTO = 'file:///a.jpg'
const DELIVERY_UNCONFIRMED = 'Delivery unconfirmed — check chat before retrying'
const connectedClient = { getState: () => 'connected', notifyForeground: vi.fn() } as unknown as RpcClient

describe('an unconfirmed send whose hold runs out with its chat on screen', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
  let bridge: ReturnType<typeof useMobileStructuredNativeChatSendBridge> | null = null
  const errors: string[] = []
  const requests: string[] = []

  beforeEach(() => {
    errors.length = 0
    requests.length = 0
    resetAppForegroundClockForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    resetNativeChatSendTimingForTests()
  })
  afterEach(async () => {
    vi.useRealTimers()
    act(() => renderer?.unmount())
    renderer = null
    resetLiveNativeChatDraftsForTests()
    resetAppForegroundClockForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    await clearNativeChatDraftStores()
  })

  /** Every request's acknowledgement is lost: the host may or may not have the message. */
  const lostAck = async (text: string): Promise<MobileNativeChatSendOutcome> => {
    requests.push(text)
    return 'unknown'
  }

  function mount(transcriptSettled: boolean): void {
    function ChatScreen(): null {
      drafts = useMobileNativeChatDrafts({
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-s',
        sessionId: 'session-s',
        messages: [],
        transcriptSettled
      })
      bridge = useMobileStructuredNativeChatSendBridge({
        agent: 'claude',
        sendStructured: lostAck,
        sendConditions: { client: connectedClient, sendable: true },
        captureSendOrigin: drafts.captureSendOrigin,
        clearDraftForSend: drafts.clearDraftForSend,
        acceptSend: drafts.acceptSend,
        holdUnconfirmedSend: drafts.holdUnconfirmedSend,
        restoreRejectedDraft: drafts.restoreRejectedDraft,
        showSendingEcho: drafts.showSendingEcho,
        onSendError: (message) => errors.push(message)
      })
      useMobileNativeChatOutbox({
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-s',
        sessionId: 'session-s',
        showNativeChat: true,
        structured: true,
        terminalChat: false,
        messages: [],
        transcriptSettled,
        receipts: [],
        inputSendable: true,
        agentWorking: false,
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

  it('says delivery is unconfirmed for a photo send, and does not hand its words back as if the app had closed', async () => {
    vi.useFakeTimers()
    mount(true)
    await act(async () => {
      drafts!.setComposerText(TEXT)
    })
    // The photo send's own start: the box and the chips empty and the photo bubble shows at once
    // (clearDraftAtSendStartWith), then the text leg goes through the bridge with the previews.
    await act(async () => {
      drafts!.clearDraftAtSendStart(TEXT, [PHOTO])
      void bridge!.sendWithOutcome(TEXT, [PHOTO])
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(drafts!.composerText).toBe('')
    await advance(25_000)

    expect(errors).toEqual([DELIVERY_UNCONFIRMED])
    // It may have arrived: the words stay out of the box, and its bubble stays.
    expect(drafts!.composerText).toBe('')
    expect(drafts!.pending.map((item) => item.text)).toEqual([TEXT])
    // Nothing is left for a recovery to give back later under the wrong reason.
    await advance(60_000)
    expect(errors).toEqual([DELIVERY_UNCONFIRMED])
    expect(nativeChatOutboxEntries()).toEqual([])
    expect(requests).toEqual([TEXT])
  })

  it('says delivery is unconfirmed when the chat has no settled transcript to look for the row in', async () => {
    vi.useFakeTimers()
    mount(false)
    await act(async () => {
      drafts!.setComposerText(TEXT)
    })
    await act(async () => {
      void bridge!.sendWithOutcome(TEXT)
      await vi.advanceTimersByTimeAsync(0)
    })
    await advance(25_000)

    expect(errors).toEqual([DELIVERY_UNCONFIRMED])
    expect(drafts!.composerText).toBe('')
  })

  it('does not hand a held photo send back as "the app closed" when its chat is reopened in the same run', async () => {
    vi.useFakeTimers()
    mount(true)
    await act(async () => {
      drafts!.setComposerText(TEXT)
    })
    await act(async () => {
      drafts!.clearDraftAtSendStart(TEXT, [PHOTO])
      void bridge!.sendWithOutcome(TEXT, [PHOTO])
      await vi.advanceTimersByTimeAsync(0)
    })
    // The user leaves the chat while it is held (a tab switch): the process lives on.
    act(() => renderer?.unmount())
    renderer = null
    await advance(1_000)
    mount(true)
    await advance(30_000)

    expect(errors.filter((message) => message.includes('the app closed'))).toEqual([])
    expect(drafts!.composerText).toBe('')
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('control: with a settled transcript a text send is still seen through by the recovery, without the notice', async () => {
    vi.useFakeTimers()
    mount(true)
    await act(async () => {
      drafts!.setComposerText(TEXT)
    })
    await act(async () => {
      void bridge!.sendWithOutcome(TEXT)
      await vi.advanceTimersByTimeAsync(0)
    })
    await advance(25_000)

    // The recovery resent it under the press's operation id; nothing was said.
    expect(requests.length).toBeGreaterThanOrEqual(2)
    expect(errors).toEqual([])
  })
})
