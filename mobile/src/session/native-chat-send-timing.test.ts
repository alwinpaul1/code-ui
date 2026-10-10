// "Sometimes a message takes too long to send" (2026-10-10): the phone kept no timings, so a slow
// send could not be read back afterwards. Each composer send now leaves one line in its host's
// connection log with each stage's time, and names the stage that held a slow one. Never the
// words: only lengths, timings and the tab.
//
// Drives the REAL message send, the REAL image hook and the REAL draft store; the link to the
// desktop comes up 3.5 s after the tap (a relay re-dial after the app resumed).

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionLogEntry } from '../transport/types'
import { connectionLogStore } from '../transport/persisted-connection-log-store'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { resetLiveNativeChatDraftsForTests } from './mobile-native-chat-live-drafts'
import { baseArgs, ok } from './use-mobile-native-chat-image-attachments.test-support'
import { resetNativeChatOutboxForTests } from '../storage/native-chat-outbox'
import { resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { describeNativeChatSendTiming, resetNativeChatSendTimingForTests } from './native-chat-send-timing'

vi.mock('../platform/media-picker', () => ({ useMediaPicker: () => ({ pickImages: vi.fn() }) }))
vi.mock('./mobile-image-source-picker', () => ({
  pickMobileDocuments: vi.fn(),
  pickMobileImageFiles: vi.fn()
}))
vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => false),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))

const PRIVATE = 'tell nobody about the zebra crossing plan'

describe('the connection-log line a send leaves', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
  let images: ReturnType<typeof useMobileNativeChatImageAttachments> | null = null
  let lines: { hostId: string; entry: ConnectionLogEntry }[] = []

  beforeEach(() => {
    lines = []
    vi.spyOn(connectionLogStore, 'append').mockImplementation((hostId, entry) => {
      lines.push({ hostId, entry })
    })
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    resetNativeChatSendTimingForTests()
    useNativeChatImageAttachmentsStore.getState().reset()
  })
  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    act(() => renderer?.unmount())
    renderer = null
    resetLiveNativeChatDraftsForTests()
    await clearNativeChatDraftStores()
  })

  it('names readiness as what held a send that waited for the link, without the words', async () => {
    let connected = false
    // A Codex tab: its send is a clear and a body, with no screen check after the Enter.
    const client = {
      getState: () => (connected ? 'connected' : 'disconnected'),
      notifyForeground: vi.fn(),
      getLastConnectedAt: () => 1,
      getActivePath: () => 'relay',
      sendRequest: vi.fn(async (method: string) =>
        method === 'terminal.read'
          ? ok('r', { terminal: { source: 'screen', tail: ['› '], draft: '' } })
          : ok('s', { send: { accepted: true } })
      )
    } as unknown as RpcClient
    function ChatScreen(): null {
      drafts = useMobileNativeChatDrafts({
        hostId: 'host-1',
        worktreeId: 'w',
        tabId: 'tab-7',
        sessionId: 'session-1',
        messages: [],
        transcriptSettled: true
      })
      const send = useMobileNativeChatMessageSend({
        client,
        enabled: true,
        handleRef: { current: 'term-1' },
        deviceTokenRef: { current: null },
        agentRef: { current: 'codex' },
        commandSendRef: { current: vi.fn() },
        captureSendOrigin: drafts.captureSendOrigin,
        readSeededLaunchDraftSeed: () => null,
        clearDraftForSend: drafts.clearDraftForSend,
        restoreRejectedDraft: drafts.restoreRejectedDraft,
        acceptSend: drafts.acceptSend,
        holdUnconfirmedSend: drafts.holdUnconfirmedSend,
        onSendError: vi.fn()
      })
      images = useMobileNativeChatImageAttachments(
        baseArgs({
          client,
          agent: 'codex',
          hostTerminalOfTab: () => 'term-1',
          scopeKey: 'host-1\0w\0tab-7',
          beginImageSend: drafts.clearDraftAtSendStart,
          baseSend: (text, previews, deadline, _attachments, follow) =>
            send.sendWithOutcome(text, previews, deadline, follow)
        })
      )
      return null
    }
    act(() => {
      renderer = create(createElement(ChatScreen))
    })
    await act(async () => {
      drafts!.setComposerText(PRIVATE)
    })
    vi.useFakeTimers()
    let sending: Promise<boolean> | null = null
    await act(async () => {
      sending = images!.sendNativeChat(PRIVATE)
      await vi.advanceTimersByTimeAsync(3_500)
    })
    connected = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(await sending!).toBe(true)

    const sends = lines.filter((line) => line.entry.code === 'chat-send-timing')
    expect(sends).toHaveLength(1)
    const [{ hostId, entry }] = sends as [{ hostId: string; entry: ConnectionLogEntry }]
    expect(hostId).toBe('host-1')
    expect(entry.level).toBe('warn')
    expect(entry.message).toBe('Message sent')
    expect(entry.detail).toMatch(/^total \d+ ms \(slow: readiness \d+ ms\)/)
    expect(entry.detail).toContain('via relay')
    expect(entry.detail).toContain(`${PRIVATE.length} chars`)
    expect(entry.detail).toContain('tab tab-7')
    expect(JSON.stringify(entry)).not.toContain('zebra')
    expect(JSON.stringify(entry)).not.toContain('nobody')
  })

  it('never names the outbox write, which runs beside the send, as what held it', () => {
    const { slow, dominant } = describeNativeChatSendTiming(
      {
        startedAt: 0,
        chars: 5,
        images: 0,
        stages: new Map([
          ['outbox', 4_000],
          ['write', 900]
        ]),
        path: 'lan',
        outcome: 'accepted',
        draftKey: 'h\0w\0t'
      },
      4_100
    )
    expect(slow).toBe(true)
    expect(dominant).toBe('write')
  })
})
