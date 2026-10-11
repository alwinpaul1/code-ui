// A message the chat's recovery resent and the desktop refused says "Not sent" with Retry. Until
// 2026-10-11 the refused resend left the entry marked as carried by a live send for the rest of
// the run (recordOutboxSend took it, and nothing let it go), so the recovery skipped it from then
// on: Retry cleared "Not sent", drew "Sending…" and sent nothing until the app was restarted. The
// recovery's resend now claims the entry for its length and lets it go when the send ends
// (claimOutboxSend / unclaimOutboxSend), except after an unknown answer, whose hold carries it.
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
import {
  nativeChatOutboxEntries,
  resetNativeChatOutboxForTests,
  type NativeChatOutboxEntry
} from '../storage/native-chat-outbox'
import { resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { resetNativeChatSendTimingForTests } from './native-chat-send-timing'
import { resetAppForegroundClockForTests } from './app-foreground-clock'
import { outboxEchoId } from './mobile-native-chat-outbox-drafts'

const TEXT = 'deploy it when the tests pass'
const connectedClient = { getState: () => 'connected', notifyForeground: vi.fn() } as unknown as RpcClient

describe('Retry on a message whose resend the desktop refused', () => {
  let renderer: ReactTestRenderer | null = null
  let outbox: ReturnType<typeof useMobileNativeChatOutbox> | null = null
  const requests: string[] = []
  let answer: MobileNativeChatSendOutcome = 'rejected'

  beforeEach(() => {
    requests.length = 0
    answer = 'rejected'
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
        return answer
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

  it('sends it again when the user taps Retry', async () => {
    vi.useFakeTimers()
    const left: NativeChatOutboxEntry = {
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
      autoAttempts: 0
    }
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([left]))
    act(() => {
      renderer = create(createElement(ChatScreen))
    })
    await advance(3_000)
    expect(requests).toEqual([TEXT])
    expect(Object.values(outbox!.deliveries)).toEqual(['failed'])

    answer = 'accepted'
    await act(async () => {
      outbox!.retry(outboxEchoId('send-1'))
    })
    await advance(3_000)
    expect(requests).toEqual([TEXT, TEXT])
    expect(nativeChatOutboxEntries()).toEqual([])
  })
})
