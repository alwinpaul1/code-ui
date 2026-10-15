// An outbox entry written by a Claude tab that sends through Anthropic carries the session,
// account and uuid it was posted under (`ccr`). When that record does not read back from disk, the
// store dropped it and marked the entry failed, and the entry then looked like a terminal one: Retry
// typed it into the desktop terminal, or on the Anthropic lane posted it again under a new uuid
// (second review of 5da46b13b, 2026-10-15). Such an entry may only go back into the composer.
//
// Drives the REAL draft store, the REAL Anthropic composer send and the REAL outbox recovery.

import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeChatOutboxEntries, resetNativeChatOutboxForTests, type NativeChatOutboxEntry } from '../storage/native-chat-outbox'
import { resetAppForegroundClockForTests } from './app-foreground-clock'
import type { buildCcrUserEventBody } from './ccr-send'
import { resetLiveNativeChatDraftsForTests } from './mobile-native-chat-live-drafts'
import { outboxEchoId } from './mobile-native-chat-outbox-drafts'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { resetNativeChatSendTimingForTests } from './native-chat-send-timing'
import { useCcrComposerSend, type CcrComposerSendDeps } from './use-ccr-composer-send'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { useMobileNativeChatOutbox } from './use-mobile-native-chat-outbox'

const CSE = 'cse_01FaTuRHkvnrgXpjd3nuGiQF'
const ACCOUNT = 'acct-personal'
const TEXT = 'deploy it when the tests pass'
const DRAFT_KEY = 'h\0w\0tab-c'

type Body = ReturnType<typeof buildCcrUserEventBody>
const posts: { sessionId: string; body: Body }[] = []
let answer: () => Promise<void> = async () => undefined
const terminal: string[] = []
let uuids = 0
const deps: CcrComposerSendDeps = {
  post: async (_account, sessionId, body) => {
    posts.push({ sessionId, body })
    await answer()
  },
  readStatus: async () => 'connected',
  log: () => undefined,
  newUuid: () => `uuid-${(uuids += 1)}`,
  restoreDraft: async () => undefined
}
const view = { onLane: true }
let screen: { send: (text: string) => Promise<MobileNativeChatSendOutcome>; retry: (rowId: string) => void; composer: string } | null = null

function ChatScreen(): null {
  const drafts = useMobileNativeChatDrafts({ hostId: 'h', worktreeId: 'w', tabId: 'tab-c', sessionId: 'session-c', messages: [], transcriptSettled: true })
  const ccr = useCcrComposerSend({
    active: view.onLane,
    tabId: 'tab-c',
    resolveTarget: () => ({ kind: 'target', sessionId: CSE, accountId: ACCOUNT }),
    events: [],
    connectionStatus: 'connected',
    working: false,
    promptUp: false,
    attachments: () => 0,
    composerText: drafts.composerText,
    setComposerText: drafts.setComposerText,
    captureSendOrigin: drafts.captureSendOrigin,
    clearDraftForSend: drafts.clearDraftForSend,
    acceptSend: drafts.acceptSend,
    restoreRejectedDraft: drafts.restoreRejectedDraft, returnQueueToDraft: vi.fn(),
    removePending: drafts.removePending,
    onSendError: () => undefined,
    deps
  })
  const outbox = useMobileNativeChatOutbox({
    hostId: 'h',
    worktreeId: 'w',
    tabId: 'tab-c',
    sessionId: 'session-c',
    showNativeChat: true,
    structured: false,
    terminalChat: true,
    agent: 'claude',
    terminal: 'term-1',
    messages: [],
    transcriptSettled: true,
    receipts: [],
    inputSendable: true,
    agentWorking: false,
    promptUp: false,
    queuedCount: 0,
    composerText: drafts.composerText,
    setComposerText: drafts.setComposerText,
    sendTerminal: async (text) => {
      terminal.push(text)
      return 'accepted'
    },
    sendStructured: async () => 'rejected',
    ...(view.onLane ? { sendAnthropic: ccr.resendFromOutbox } : {}),
    showEcho: drafts.showOutboxEcho,
    removeEcho: drafts.removePending,
    onNotice: () => undefined
  })
  screen = { send: ccr.sendWithOutcome, retry: outbox.retry, composer: drafts.composerText }
  return null
}

const entry = (patch: Partial<NativeChatOutboxEntry>): NativeChatOutboxEntry => ({
  id: 'send-1',
  draftKey: DRAFT_KEY,
  pendingKey: `${DRAFT_KEY}\0session-c`,
  text: TEXT,
  normalizedText: TEXT,
  baselineOccurrences: 0,
  baselineTailMessageId: null,
  baselineResolved: true,
  createdAt: Date.now() - 60_000,
  operationId: 'op-1',
  autoAttempts: 0,
  ccr: { sessionId: CSE, accountId: ACCOUNT, uuid: 'kept-uuid' },
  ...patch
})

describe('an Anthropic entry whose session record does not read back', () => {
  let renderer: ReactTestRenderer | null = null
  beforeEach(() => {
    posts.length = 0
    terminal.length = 0
    uuids = 0
    view.onLane = false
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

  async function unreadableThenRetry(): Promise<void> {
    vi.useFakeTimers()
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([entry({ ccr: { sessionId: 5 } as unknown as NativeChatOutboxEntry['ccr'] })]))
    act(() => {
      renderer = create(createElement(ChatScreen))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await act(async () => {
      screen!.retry(outboxEchoId('send-1'))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
  }

  it('is never typed into the terminal, even on Retry', async () => {
    await unreadableThenRetry()
    expect(terminal).toEqual([])
    expect(screen!.composer).toBe(TEXT)
  })

  it('is never posted under a new uuid on the Anthropic lane, even on Retry: its words go back to the composer', async () => {
    view.onLane = true
    await unreadableThenRetry()
    expect(posts).toEqual([])
    expect(terminal).toEqual([])
    expect(screen!.composer).toBe(TEXT)
    expect(nativeChatOutboxEntries()).toEqual([])
  })
})
