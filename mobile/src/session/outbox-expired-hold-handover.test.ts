// What an unconfirmed send says when its hold runs out, or its chat closes under it.
//
// Until 0.9.127 a send whose acknowledgement was lost was held for its row for 20 s of foreground
// time (mobile-native-chat-unconfirmed-hold.ts), and if none came it said "Delivery unconfirmed —
// check chat before retrying" and left the words out of the box, since they may well have arrived
// (0.9.118, 0.9.119). The 0.9.127 outbox hands an expired hold to the chat's recovery instead
// whenever one is mounted, and stops saying anything itself. That is right when the recovery can
// act on it. It found holds it cannot act on, and they lost the old notice:
//
// - a photo send: the recovery never resends files, so it gave the words back with "the app closed
//   before it reached your desktop. Attach the files again", though the app never closed and the
//   photo may have arrived (re-attaching it then posts it twice). The same false reason came back
//   when the chat was merely closed under the held send and opened again in the same run;
// - a chat whose transcript is not a settled read (from the start, or reloading as the hold ran
//   out): the recovery waits for one, so the bubble said "Sending…" for good and nothing was said;
//   and once a notice is said, the recovery must not later resend the same message by itself,
//   which doubles it when the user does what the notice says.
//
// A photo send the process died with must still come back after the restart, whether or not its
// chat had closed first (review of the first fix, 2026-10-11).
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

let settled = true
/** How the host answers; by default every acknowledgement is lost. */
let outcomeFor: (text: string) => Promise<MobileNativeChatSendOutcome> = async () => 'unknown'

describe('an unconfirmed send whose hold runs out or whose chat closes under it', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
  let bridge: ReturnType<typeof useMobileStructuredNativeChatSendBridge> | null = null
  const errors: string[] = []
  const requests: string[] = []

  beforeEach(() => {
    errors.length = 0
    requests.length = 0
    settled = true
    outcomeFor = async () => 'unknown'
    resetAppForegroundClockForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    resetNativeChatSendTimingForTests()
  })
  afterEach(async () => {
    vi.clearAllTimers()
    vi.useRealTimers()
    act(() => renderer?.unmount())
    renderer = null
    resetLiveNativeChatDraftsForTests()
    resetAppForegroundClockForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    await clearNativeChatDraftStores()
  })

  const desk = async (text: string): Promise<MobileNativeChatSendOutcome> => {
    requests.push(text)
    return outcomeFor(text)
  }

  function ChatScreen(): null {
    drafts = useMobileNativeChatDrafts({
      hostId: 'h',
      worktreeId: 'w',
      tabId: 'tab-s',
      sessionId: 'session-s',
      messages: [],
      transcriptSettled: settled
    })
    bridge = useMobileStructuredNativeChatSendBridge({
      agent: 'claude',
      sendStructured: desk,
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
      transcriptSettled: settled,
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
  function mount(): void {
    act(() => {
      renderer = create(createElement(ChatScreen))
    })
  }
  function rerender(): void {
    act(() => {
      renderer!.update(createElement(ChatScreen))
    })
  }
  function closeChat(): void {
    act(() => renderer?.unmount())
    renderer = null
  }
  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }
  /** A photo send's own start (clearDraftAtSendStartWith), then its text leg through the bridge. */
  async function pressPhoto(): Promise<void> {
    await act(async () => {
      drafts!.setComposerText(TEXT)
    })
    await act(async () => {
      drafts!.clearDraftAtSendStart(TEXT, [PHOTO])
      void bridge!.sendWithOutcome(TEXT, [PHOTO])
      await vi.advanceTimersByTimeAsync(0)
    })
  }
  async function pressText(): Promise<void> {
    await act(async () => {
      drafts!.setComposerText(TEXT)
    })
    await act(async () => {
      void bridge!.sendWithOutcome(TEXT)
      await vi.advanceTimersByTimeAsync(0)
    })
  }
  /** Android kills the process: no effect cleanup runs; only storage survives. */
  async function kill(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    vi.clearAllTimers()
    resetLiveNativeChatDraftsForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    resetNativeChatSendTimingForTests()
    // The dead tree's cleanup must not touch the new process's state: dropped with nothing in memory.
    closeChat()
  }

  it('says delivery is unconfirmed for a photo send, and does not hand its words back as if the app had closed', async () => {
    vi.useFakeTimers()
    mount()
    await pressPhoto()
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
    settled = false
    mount()
    await pressText()
    await advance(25_000)

    expect(errors).toEqual([DELIVERY_UNCONFIRMED])
    expect(drafts!.composerText).toBe('')
  })

  it('does not resend by itself a message it already called unconfirmed, once a reloading transcript settles', async () => {
    vi.useFakeTimers()
    mount()
    await pressText()
    await advance(10_000)
    settled = false
    rerender()
    await advance(15_000)
    expect(errors).toEqual([DELIVERY_UNCONFIRMED])

    // The user does what it says and sends it again by hand.
    outcomeFor = async () => 'accepted'
    await pressText()
    settled = true
    rerender()
    await advance(5_000)
    expect(requests).toEqual([TEXT, TEXT])
  })

  it('says delivery is unconfirmed, not "the app closed", for a held photo send whose chat is reopened in the same run', async () => {
    vi.useFakeTimers()
    mount()
    await pressPhoto()
    // The user leaves the chat while it is held (a tab switch): the process lives on.
    closeChat()
    await advance(1_000)
    mount()
    await advance(30_000)

    expect(errors).toEqual([DELIVERY_UNCONFIRMED])
    // The words are back to send again if the chat does not show it.
    expect(drafts!.composerText).toBe(TEXT)
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('gives a held photo send back after a restart when its chat closed before the process died', async () => {
    vi.useFakeTimers()
    mount()
    await pressPhoto()
    await advance(5_000)
    closeChat()
    await advance(0)
    await kill()
    mount()
    await advance(2_000)

    expect(drafts!.composerText).toBe(TEXT)
    expect(errors.some((message) => message.includes('Attach the files'))).toBe(true)
  })

  it('gives a photo send back after a restart when its ack was lost after its chat closed', async () => {
    vi.useFakeTimers()
    let resolve: (outcome: MobileNativeChatSendOutcome) => void = () => {}
    outcomeFor = () =>
      new Promise((done) => {
        resolve = done
      })
    mount()
    await pressPhoto()
    closeChat()
    await act(async () => {
      resolve('unknown')
      await vi.advanceTimersByTimeAsync(0)
    })
    await kill()
    mount()
    await advance(2_000)

    expect(drafts!.composerText).toBe(TEXT)
    expect(errors.some((message) => message.includes('Attach the files'))).toBe(true)
  })

  it('control: with a settled transcript a text send is still seen through by the recovery, without the notice', async () => {
    vi.useFakeTimers()
    mount()
    await pressText()
    await advance(25_000)

    // The recovery resent it under the press's operation id; nothing was said.
    expect(requests.length).toBeGreaterThanOrEqual(2)
    expect(errors).toEqual([])
  })
})
