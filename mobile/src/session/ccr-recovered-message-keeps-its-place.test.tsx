// A message the killed app left in the outbox, resent through Anthropic on the next launch,
// beside the messages the user sends after the relaunch (second review of 5da46b13b, 2026-10-15):
//  - the in-flight guard refused the recovery resend while the user's own POST was slow, and the
//    recovered message said "Not sent" with an "Another input is still being sent" toast;
//  - a message sent after the relaunch, or a queue sent at a turn's end, posted ahead of it;
//  - its echo already on the stream did not stop it being posted again;
//  - a queue sent at a turn's end and a recovery resend could both be out at once.
// Same harness as ccr-send-survives-app-kill.test.tsx, with the echo stream, the POST's answer,
// the status read, Claude's working state and the error line under the test's control. Drives the
// REAL draft store, the REAL Anthropic composer send and the REAL outbox recovery.

import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeChatOutboxEntries, resetNativeChatOutboxForTests, type NativeChatOutboxEntry } from '../storage/native-chat-outbox'
import { resetAppForegroundClockForTests } from './app-foreground-clock'
import type { buildCcrUserEventBody } from './ccr-send'
import type { CcrEvent } from './ccr-session-api'
import { resetLiveNativeChatDraftsForTests } from './mobile-native-chat-live-drafts'
import { outboxEchoId } from './mobile-native-chat-outbox-drafts'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { claimOutboxSend, resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { resetNativeChatSendTimingForTests } from './native-chat-send-timing'
import { CCR_SEND_IN_FLIGHT, useCcrComposerSend, type CcrComposerSendDeps } from './use-ccr-composer-send'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { useMobileNativeChatOutbox } from './use-mobile-native-chat-outbox'

const CSE = 'cse_01FaTuRHkvnrgXpjd3nuGiQF'
const ACCOUNT = 'acct-personal'
const OLD = 'the message the killed app left behind'
const NEW = 'a new message typed after the relaunch'
const DRAFT_KEY = 'h\0w\0tab-c'

type Body = ReturnType<typeof buildCcrUserEventBody>
const posts: { sessionId: string; body: Body }[] = []
const answers: (() => void)[] = []
let slow = false
let inFlight = 0
let maxInFlight = 0
const statusReads: (() => void)[] = []
let slowStatus = false
const errors: string[] = []
let uuids = 0
const deps: CcrComposerSendDeps = {
  post: async (_account, sessionId, body) => {
    posts.push({ sessionId, body })
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    try {
      if (slow) {
        await new Promise<void>((resolve) => answers.push(resolve))
      }
    } finally {
      inFlight -= 1
    }
  },
  readStatus: async () => {
    if (slowStatus) {
      await new Promise<void>((resolve) => statusReads.push(resolve))
    }
    return 'connected'
  },
  log: () => undefined,
  newUuid: () => `uuid-${(uuids += 1)}`,
  restoreDraft: async () => undefined
}
const view = { events: [] as CcrEvent[], working: false, connectionStatus: 'connected' as string | null }
let screen: { send: (text: string) => Promise<MobileNativeChatSendOutcome>; retry: (rowId: string) => void } | null = null

function ChatScreen(): null {
  const drafts = useMobileNativeChatDrafts({ hostId: 'h', worktreeId: 'w', tabId: 'tab-c', sessionId: 'session-c', messages: [], transcriptSettled: true })
  const ccr = useCcrComposerSend({
    active: true,
    tabId: 'tab-c',
    resolveTarget: () => ({ kind: 'target', sessionId: CSE, accountId: ACCOUNT }),
    events: view.events,
    connectionStatus: view.connectionStatus,
    working: view.working,
    promptUp: false,
    attachments: () => 0,
    composerText: drafts.composerText,
    setComposerText: drafts.setComposerText,
    captureSendOrigin: drafts.captureSendOrigin,
    clearDraftForSend: drafts.clearDraftForSend,
    acceptSend: drafts.acceptSend,
    restoreRejectedDraft: drafts.restoreRejectedDraft,
    removePending: drafts.removePending,
    onSendError: (message) => errors.push(message),
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
    agentWorking: view.working,
    promptUp: false,
    queuedCount: 0,
    composerText: drafts.composerText,
    setComposerText: drafts.setComposerText,
    sendTerminal: async () => 'accepted',
    sendStructured: async () => 'rejected',
    sendAnthropic: ccr.resendFromOutbox,
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
  text: OLD,
  normalizedText: OLD,
  baselineOccurrences: 0,
  baselineTailMessageId: null,
  baselineResolved: true,
  createdAt: Date.now() - 60_000,
  operationId: 'op-1',
  autoAttempts: 0,
  ccr: { sessionId: CSE, accountId: ACCOUNT, uuid: 'kept-uuid' },
  ...patch
})

const postedTexts = (): unknown[] => posts.map((post) => (post.body.events[0]?.payload.message as { content?: unknown } | undefined)?.content)

describe('a recovered message on the Anthropic lane', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    posts.length = 0
    answers.length = 0
    errors.length = 0
    slow = false
    uuids = 0
    inFlight = 0
    maxInFlight = 0
    statusReads.length = 0
    slowStatus = false
    view.events = []
    view.working = false
    view.connectionStatus = 'connected'
    resetAppForegroundClockForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    resetNativeChatSendTimingForTests()
  })
  afterEach(async () => {
    for (const answer of answers) {
      answer()
    }
    for (const read of statusReads) {
      read()
    }
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

  it('does not mark a recovered message "Not sent" because the user sent a new one on a slow network', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([entry({})]))
    slow = true
    await mount()
    // Before the 2 s idle settle runs out, the user sends a new message whose POST is slow.
    await act(async () => {
      void screen!.send(NEW)
      await Promise.resolve()
    })
    await advance(5_000)
    const old = nativeChatOutboxEntries().find((item) => item.id === 'send-1')
    expect(errors).toEqual([])
    expect(old?.failed).toBeUndefined()
  })

  it('a Retry tapped while the user\'s own send is slow waits for it instead of saying "Not sent"', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([entry({ failed: true })]))
    slow = true
    await mount()
    await act(async () => {
      void screen!.send(NEW)
      await Promise.resolve()
    })
    expect(postedTexts()).toEqual([NEW])
    await act(async () => {
      screen!.retry(outboxEchoId('send-1'))
    })
    // Past the idle settle: the outbox resends the retried message while NEW's POST is still out.
    await advance(5_000)
    expect(errors).toEqual([])
    expect(nativeChatOutboxEntries().find((item) => item.id === 'send-1')?.failed).toBeUndefined()
    expect(postedTexts()).toEqual([NEW])
    for (const answer of answers.splice(0)) {
      answer()
    }
    await advance(100)
    expect(postedTexts()).toEqual([NEW, OLD])
    expect(errors).toEqual([])
  })

  it('posts the older recovered message before the new one (send order)', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([entry({})]))
    await mount()
    await act(async () => {
      void screen!.send(NEW)
      await Promise.resolve()
    })
    await advance(5_000)
    expect(postedTexts()).toEqual([OLD, NEW])
  })

  it('a new message does not post the recovered one again when its echo is already on the stream', async () => {
    vi.useFakeTimers()
    view.events = [{ payload: { type: 'user', uuid: 'kept-uuid', message: { role: 'user', content: OLD } } } as unknown as CcrEvent]
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([entry({})]))
    await mount()
    await act(async () => {
      void screen!.send(NEW)
      await Promise.resolve()
    })
    await advance(5_000)
    expect(postedTexts()).toEqual([NEW])
  })

  it('refuses a new message, words kept, while the outbox is already carrying the older one', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([entry({})]))
    await mount()
    // The outbox's resend has claimed it and is writing its attempt count before it posts.
    expect(claimOutboxSend('send-1')).toBe(true)
    let outcome: MobileNativeChatSendOutcome | null = null
    await act(async () => {
      outcome = await screen!.send(NEW)
    })
    expect(outcome).toBe('rejected')
    expect(errors).toEqual([CCR_SEND_IN_FLIGHT])
    expect(posts).toEqual([])
  })

  it('does not post a recovered message again when its echo is already on the stream', async () => {
    vi.useFakeTimers()
    view.events = [{ payload: { type: 'user', uuid: 'kept-uuid', message: { role: 'user', content: OLD } } } as unknown as CcrEvent]
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([entry({})]))
    await mount()
    await advance(5_000)
    expect(posts).toEqual([])
  })

  it('posts the older recovered message before a queue sent at the turn end', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([entry({})]))
    view.working = true
    await mount()
    await act(async () => {
      await screen!.send(NEW)
    })
    expect(posts).toEqual([])
    // The turn ends: the queue goes at once, before the outbox's idle settle has run out.
    view.working = false
    act(() => renderer!.update(createElement(ChatScreen)))
    await advance(5_000)
    expect(postedTexts()).toEqual([OLD, NEW])
  })

  it('never has a queued message and a recovered one out at once, and never posts the queue first', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([entry({})]))
    view.working = true
    await mount()
    // Typed while Claude works: it waits on the phone.
    await act(async () => {
      await screen!.send(NEW)
    })
    expect(posts).toEqual([])
    // The turn ends while the stream has not said whether the computer is connected, and reading
    // it is slow: the queue's turn-end send waits on that read past the recovery's idle settle.
    view.connectionStatus = null
    slowStatus = true
    view.working = false
    slow = true
    act(() => renderer!.update(createElement(ChatScreen)))
    await advance(3_000)
    slowStatus = false
    for (const read of statusReads.splice(0)) {
      read()
    }
    await advance(100)
    for (const answer of answers.splice(0)) {
      answer()
    }
    await advance(5_000)
    for (const answer of answers.splice(0)) {
      answer()
    }
    await advance(5_000)
    expect(maxInFlight).toBe(1)
    const texts = postedTexts()
    expect(texts[0]).toBe(OLD)
    expect(texts.filter((text) => text === OLD)).toHaveLength(1)
  })
})
