// A Claude tab's Anthropic send cleared the composer and posted with nothing on disk: an app
// killed while the POST was out took the words with it, unlike a terminal send, which the outbox
// keeps until it is known to have landed (review of the send lane, 2026-10-15). And the outbox's
// recovery and Retry on such a tab still typed into the terminal. A send on this lane is now
// written to the outbox with its target and uuid before the box empties, kept until the POST is
// answered, and resent from there through Anthropic under the same uuid, never through the
// terminal.
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
import { outboxEntryDrainable, resetOutboxSendsForTests } from './native-chat-outbox-sends'
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
let screen: { send: (text: string) => Promise<MobileNativeChatSendOutcome>; retry: (rowId: string) => void } | null = null

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
  screen = { send: ccr.sendWithOutcome, retry: outbox.retry }
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

const postedUuids = (): unknown[] => posts.map((post) => post.body.events[0]?.payload.uuid)

describe('a message sent through Anthropic and the outbox', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    posts.length = 0
    terminal.length = 0
    uuids = 0
    answer = async () => undefined
    view.onLane = true
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

  async function mount(): Promise<void> {
    act(() => {
      renderer = create(createElement(ChatScreen))
    })
    await act(async () => {
      await Promise.resolve()
    })
  }
  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  it('keeps the words on disk, with their session and uuid, until the POST is answered', async () => {
    let release!: () => void
    answer = () => new Promise<void>((resolve) => (release = resolve))
    await mount()
    let sent: Promise<MobileNativeChatSendOutcome> | null = null
    await act(async () => {
      sent = screen!.send(TEXT)
      await Promise.resolve()
    })
    const held = nativeChatOutboxEntries().filter((item) => item.text === TEXT)
    expect(held).toHaveLength(1)
    expect(held[0]!.ccr).toEqual({ sessionId: CSE, accountId: ACCOUNT, uuid: 'uuid-1' })
    expect(held[0]!.route).toBeUndefined()
    await act(async () => {
      release()
      await sent
    })
    expect(nativeChatOutboxEntries().filter((item) => item.text === TEXT)).toEqual([])
  })

  it('resends a message a killed app left in the outbox through Anthropic, under its own uuid, never the terminal', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([entry({})]))
    await mount()
    await advance(5_000)
    expect(terminal).toEqual([])
    expect(posts.map((post) => post.sessionId)).toEqual([CSE])
    expect(postedUuids()).toEqual(['kept-uuid'])
  })

  it('posts a failed one again through Anthropic on Retry', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([entry({ failed: true, autoAttempts: 2 })]))
    await mount()
    await advance(1_000)
    expect(posts).toEqual([])
    await act(async () => {
      screen!.retry(outboxEchoId('send-1'))
    })
    await advance(3_000)
    expect(terminal).toEqual([])
    expect(postedUuids()).toEqual(['kept-uuid'])
  })

  it('waits, and types nothing, while its tab sends through the terminal', async () => {
    vi.useFakeTimers()
    view.onLane = false
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([entry({})]))
    await mount()
    await advance(5_000)
    expect(terminal).toEqual([])
    expect(posts).toEqual([])
    expect(nativeChatOutboxEntries().map((item) => item.id)).toEqual(['send-1'])
  })
})

describe('the app-wide drainer and an Anthropic entry', () => {
  it('never takes one, even with a terminal route on it, so it is never typed into a terminal', () => {
    const route = { hostId: 'h', worktreeId: 'w', tabId: 'tab-c', lane: 'terminal' as const, agent: 'claude', sessionId: 'session-c', terminal: 'term-1', transcriptPath: null }
    expect(outboxEntryDrainable(entry({ route }))).toBe(false)
    expect(outboxEntryDrainable(entry({ route, ccr: undefined }))).toBe(true)
  })
})
