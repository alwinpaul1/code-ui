// Opus review of c4633b5de: an entry's `hostAcked` (the desktop answered a write of it, so its
// bubble is drawn at full strength) was never taken off. A message whose body was acked, then
// held, resent by the outbox and refused, said "Not sent"; a tap on Retry then drew it at full
// strength before anything was written, and with the desktop away it sat looking sent. Each new
// attempt starts on its way again: dimmed until ITS write is answered.
//
// Drives the REAL draft store, the REAL structured send bridge and the REAL outbox recovery.

import AsyncStorage from '@react-native-async-storage/async-storage'
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
import { resetNativeChatOutboxForTests, type NativeChatOutboxEntry } from '../storage/native-chat-outbox'
import { resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { resetNativeChatSendTimingForTests } from './native-chat-send-timing'
import { resetAppForegroundClockForTests } from './app-foreground-clock'
import { outboxEchoId } from './mobile-native-chat-outbox-drafts'

const TEXT = 'deploy it when the tests pass'
const connectedClient = { getState: () => 'connected', notifyForeground: vi.fn() } as unknown as RpcClient

describe('Retry on a message the desktop had acked once', () => {
  let renderer: ReactTestRenderer | null = null
  let outbox: ReturnType<typeof useMobileNativeChatOutbox> | null = null
  const requests: string[] = []
  // The resend's answer never comes: nothing says the desktop has this attempt.
  const answer = (): Promise<MobileNativeChatSendOutcome> => new Promise(() => {})

  beforeEach(() => {
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
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    await clearNativeChatDraftStores()
    await AsyncStorage.clear()
  })

  function ChatScreen(): null {
    const drafts = useMobileNativeChatDrafts({
      hostId: 'h',
      worktreeId: 'w',
      tabId: 'tab-s',
      sessionId: 'session-s',
      messages: [],
      transcriptSettled: true
    })
    const bridge = useMobileStructuredNativeChatSendBridge({
      agent: 'claude',
      sendStructured: async (text) => {
        requests.push(text)
        return answer()
      },
      sendConditions: { client: connectedClient, sendable: true },
      captureSendOrigin: drafts.captureSendOrigin,
      clearDraftForSend: drafts.clearDraftForSend,
      acceptSend: drafts.acceptSend,
      holdUnconfirmedSend: drafts.holdUnconfirmedSend,
      restoreRejectedDraft: drafts.restoreRejectedDraft,
      showSendingEcho: drafts.showSendingEcho,
      onSendError: () => {}
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
      agentWorking: false,
      promptUp: false,
      queuedCount: 0,
      composerText: drafts.composerText,
      setComposerText: drafts.setComposerText,
      sendTerminal: async () => 'rejected',
      sendStructured: (text) => bridge.sendWithOutcome(text),
      showEcho: drafts.showOutboxEcho,
      removeEcho: drafts.removePending,
      onNotice: () => {}
    })
    return null
  }

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  it('dims it again until the new attempt’s write is answered', async () => {
    vi.useFakeTimers()
    const failed: NativeChatOutboxEntry = {
      id: 'send-1',
      draftKey: 'h\0w\0tab-s',
      pendingKey: 'h\0w\0tab-s\0session-s',
      text: TEXT,
      normalizedText: TEXT,
      baselineOccurrences: 0,
      baselineTailMessageId: null,
      baselineResolved: true,
      createdAt: Date.now() - 60_000,
      operationId: 'op-1',
      autoAttempts: 1,
      failed: true,
      hostAcked: true
    }
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([failed]))
    act(() => {
      renderer = create(createElement(ChatScreen))
    })
    await advance(1_000)
    expect(outbox!.deliveries[outboxEchoId('send-1')]).toBe('failed')

    await act(async () => {
      outbox!.retry(outboxEchoId('send-1'))
    })
    await advance(3_000)
    expect(requests).toEqual([TEXT])
    expect(outbox!.deliveries[outboxEchoId('send-1')]).toBe('sending')
  })
})
