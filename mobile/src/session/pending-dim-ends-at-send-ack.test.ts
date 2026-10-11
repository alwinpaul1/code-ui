// The user, 2026-10-12: a send's bubble sat at half strength until Claude had it on record, up to
// about 20 s on a send whose check could not settle, the same linger a "Sending" label was removed
// for. The Claude app dims its pending row only until its POST is acked (a 2xx, near-instant), and
// shows it normally while it waits for the echo. The phone's ack is the desktop answering the
// body write (`terminal.send`) or accepting the structured operation, so that is where the dim
// ends now. The outbox entry stays until Claude's record shows the message (delivery on record,
// docs/mobile-chat-outbox.md): only the look changes.
//
// Drives the REAL draft store, the REAL terminal message send and the REAL outbox recovery; only
// the wire is faked.

import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bodyWrite = vi.fn()
vi.mock('./mobile-native-chat-send', () => ({
  sendMobileNativeChatMessageWithOutcome: (...args: unknown[]) => bodyWrite(...args),
  typeMobileNativeChatCommandWithOutcome: vi.fn(async () => 'accepted'),
  clearMobileNativeChatInput: vi.fn(async () => true),
  openMobileNativeChatSendBudget: () => Date.now() + 15_000,
  MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS: 15_000,
  MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS: 2_000
}))
vi.mock('./mobile-native-chat-stale-input', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mobile-native-chat-stale-input')>()),
  healMobileNativeChatStaleInput: () => Promise.resolve(true)
}))
// The dim's own module draws a View; nothing here renders it.
vi.mock('react-native', () => ({ StyleSheet: { create: <T,>(styles: T) => styles }, View: 'View' }))
// No screen to look at: Claude's check cannot settle, so the send is held for Claude's record.
vi.mock('./mobile-native-chat-screen-read', () => ({ readMobileNativeChatScreen: () => Promise.resolve(null) }))

import type { RpcClient } from '../transport/rpc-client'
import { nativeChatOutboxEntries, resetNativeChatOutboxForTests } from '../storage/native-chat-outbox'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { useMobileNativeChatOutbox } from './use-mobile-native-chat-outbox'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { resetLiveNativeChatDraftsForTests } from './mobile-native-chat-live-drafts'
import { resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { resetNativeChatSendTimingForTests } from './native-chat-send-timing'
import { resetAppForegroundClockForTests } from './app-foreground-clock'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { outboxEchoId } from './mobile-native-chat-outbox-drafts'
import { pendingSendDimmed } from './MobileNativeChatPendingDim'

const TEXT = 'deploy it when the tests pass'
const client = {
  sendRequest: vi.fn(async () => ({ ok: true, result: {} })),
  getState: () => 'connected',
  notifyForeground: vi.fn()
} as unknown as RpcClient

describe('a send’s dim, which ends at the desktop’s ack', () => {
  let renderer: ReactTestRenderer | null = null
  let send: ReturnType<typeof useMobileNativeChatMessageSend> | null = null
  let outbox: ReturnType<typeof useMobileNativeChatOutbox> | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
  const onSendError = vi.fn()

  beforeEach(() => {
    bodyWrite.mockReset()
    onSendError.mockReset()
    resetAppForegroundClockForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    resetNativeChatSendTimingForTests()
    resetMobileNativeChatTerminalWritesForTests()
  })
  afterEach(async () => {
    vi.useRealTimers()
    act(() => renderer?.unmount())
    renderer = null
    send = null
    outbox = null
    drafts = null
    resetLiveNativeChatDraftsForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    await clearNativeChatDraftStores()
    await AsyncStorage.clear()
  })

  function mount(agent: 'claude' | 'codex'): void {
    function ChatScreen(): null {
      drafts = useMobileNativeChatDrafts({
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-t',
        sessionId: 'session-t',
        messages: [],
        transcriptSettled: true
      })
      send = useMobileNativeChatMessageSend({
        client,
        enabled: true,
        handleRef: { current: 'term' },
        deviceTokenRef: { current: null },
        agentRef: { current: agent },
        commandSendRef: { current: () => {} },
        captureSendOrigin: drafts.captureSendOrigin,
        readSeededLaunchDraftSeed: () => null,
        clearDraftForSend: drafts.clearDraftForSend,
        restoreRejectedDraft: drafts.restoreRejectedDraft,
        showSendingEcho: drafts.showSendingEcho,
        acceptSend: drafts.acceptSend,
        holdUnconfirmedSend: drafts.holdUnconfirmedSend,
        onSendError,
        sendOnRecord: drafts.sendOnRecord,
        refuseUnderDialog: async () => null
      })
      outbox = useMobileNativeChatOutbox({
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-t',
        sessionId: 'session-t',
        showNativeChat: true,
        structured: false,
        terminalChat: true,
        agent,
        terminal: 'term',
        messages: [],
        transcriptSettled: true,
        receipts: [],
        inputSendable: true,
        agentWorking: true,
        promptUp: false,
        queuedCount: 0,
        composerText: drafts.composerText,
        setComposerText: drafts.setComposerText,
        sendTerminal: (text) => send!.sendWithOutcome(text),
        sendStructured: async () => 'rejected',
        showEcho: drafts.showOutboxEcho,
        removeEcho: drafts.removePending,
        onNotice: () => {}
      })
      return null
    }
    act(() => {
      renderer = create(createElement(ChatScreen))
    })
  }

  async function press(): Promise<string | undefined> {
    act(() => drafts!.setComposerText(TEXT))
    let outcome: string | undefined
    await act(async () => {
      const sending = send!.sendWithOutcome(TEXT).then((value) => {
        outcome = value
      })
      await vi.advanceTimersByTimeAsync(10_000)
      await sending
    })
    return outcome
  }

  function bubbleDelivery() {
    const entry = nativeChatOutboxEntries().find((candidate) => candidate.normalizedText === TEXT)
    return { entry, delivery: entry ? outbox!.deliveries[outboxEchoId(entry.id)] : undefined }
  }

  it('draws a Claude send at full strength once the desktop took its write, while Claude’s record of it is still out', async () => {
    vi.useFakeTimers()
    bodyWrite.mockResolvedValue('accepted')
    mount('claude')
    // Held for Claude's record: the check could not settle.
    expect(await press()).toBe('unknown')
    const { entry, delivery } = bubbleDelivery()
    // Delivery on record is untouched: the entry stays until Claude's record shows the message.
    expect(entry).toBeDefined()
    expect(delivery).toBeDefined()
    expect(pendingSendDimmed(delivery)).toBe(false)
    expect(delivery).not.toBe('failed')
  })

  for (const agent of ['claude', 'codex'] as const) {
    it(`keeps a send dimmed while the desktop has not answered its write (${agent})`, async () => {
      vi.useFakeTimers()
      // The ack never came: the send is held, and nothing says the desktop has it.
      bodyWrite.mockResolvedValue('unknown')
      mount(agent)
      expect(await press()).toBe('unknown')
      const { entry, delivery } = bubbleDelivery()
      expect(entry).toBeDefined()
      expect(pendingSendDimmed(delivery)).toBe(true)
    })

    it(`gives the words back with a Retry when the desktop refused the write, as the Claude app’s snackbar does (${agent})`, async () => {
      vi.useFakeTimers()
      bodyWrite.mockResolvedValue('rejected')
      mount(agent)
      expect(await press()).toBe('rejected')
      expect(drafts!.composerText).toBe(TEXT)
      expect(onSendError).toHaveBeenCalledExactlyOnceWith('Message not sent', { retry: true })
      // Its bubble and its entry are gone: nothing waits to be sent beside the words in the box.
      expect(bubbleDelivery().entry).toBeUndefined()
    })
  }
})
