// Second review of the Anthropic lane's bubble-at-tap change (2026-10-17): a words-only composer
// send now draws its bubble or queued card and empties the box at the tap, before the status read
// (`ccrTargetOffline`) that used to come first. Each test pins one place where that reorder could
// lose, duplicate or misplace the words, or misreport them. Two harnesses: the mocked controller
// (ccr-composer-send.test-support.ts) and the REAL draft store and outbox, as
// ccr-recovered-message-keeps-its-place.test.tsx mounts them.

import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeChatOutboxEntries, resetNativeChatOutboxForTests, type NativeChatOutboxEntry } from '../storage/native-chat-outbox'
import { lockedShareAskSend, shareAskText } from './agent-image-share-ask'
import { resetAppForegroundClockForTests } from './app-foreground-clock'
import { calls, composer, CSE_A, drafts, hook, io, posts, postedTexts, render, resetCcrComposerHarness, restored, state, unmount } from './ccr-composer-send.test-support'
import { CCR_REMOTE_CONTROL_OFFLINE, type buildCcrUserEventBody } from './ccr-send'
import type { CcrEvent } from './ccr-session-api'
import { resetLiveNativeChatDraftsForTests } from './mobile-native-chat-live-drafts'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { resetNativeChatSendTimingForTests } from './native-chat-send-timing'
import { CCR_SEND_IN_FLIGHT, useCcrComposerSend, type CcrComposerSendDeps } from './use-ccr-composer-send'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { useMobileNativeChatOutbox } from './use-mobile-native-chat-outbox'

// ---------------------------------------------------------------------------------------------
// The mocked controller
// ---------------------------------------------------------------------------------------------

/** Status reads that answer only when the test says, in any order. */
function holdStatusReads(): { count: () => number; answer: (index: number, status: string) => Promise<void> } {
  const reads: ((status: string) => void)[] = []
  io.readStatus = () => new Promise<string>((resolve) => reads.push(resolve))
  return {
    count: () => reads.length,
    answer: async (index, status) => {
      await act(async () => {
        reads[index]?.(status)
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
  }
}

async function tap(text: string): Promise<{ outcome: () => MobileNativeChatSendOutcome | null }> {
  let result: MobileNativeChatSendOutcome | null = null
  await act(async () => {
    void hook.api.sendWithOutcome(text).then((outcome) => (result = outcome))
    await Promise.resolve()
  })
  return { outcome: () => result }
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Claude's turn ends on the tab on screen: the queue's turn-end delivery starts. */
async function turnEnds(): Promise<void> {
  state.working = false
  render()
  await flush()
}

describe('bubble at tap, mocked controller', () => {
  beforeEach(() => {
    resetCcrComposerHarness()
    state.connectionStatus = null
    render()
  })
  afterEach(unmount)

  // Uncertainty 3: the tap's read and the turn end's read both out.
  it('gives a queued message back with the offline notice when the turn ends while its status read is out and the turn end reads offline first', async () => {
    state.working = true
    render()
    const reads = holdStatusReads()
    const sent = await tap('and then the lint')
    await turnEnds()
    // Before the change only the tap's read is out here (nothing was queued yet); after it, the
    // turn end reads too, and that read answers first.
    if (reads.count() === 2) {
      await reads.answer(1, 'disconnected')
    }
    await reads.answer(0, 'disconnected')
    expect(calls.error).toHaveBeenCalledWith(CCR_REMOTE_CONTROL_OFFLINE)
    expect(calls.error).toHaveBeenCalledTimes(1)
    expect(posts).toEqual([])
    expect(sent.outcome()).toBe('rejected')
    expect(hook.api.queue).toEqual([])
    // Back in the box, or never out of it (before the change the box emptied only after the read).
    expect(composer.text === 'and then the lint' || calls.clear.mock.calls.length === 0).toBe(true)
  })

  it('gives a queued message back once, with one notice, when the turn ends while its status read is out and the tap reads offline first', async () => {
    state.working = true
    render()
    const reads = holdStatusReads()
    const sent = await tap('and then the lint')
    await turnEnds()
    expect(reads.count()).toBe(2)
    await reads.answer(0, 'disconnected')
    await reads.answer(1, 'disconnected')
    expect(hook.api.queue).toEqual([])
    expect(composer.text).toBe('and then the lint')
    expect(posts).toEqual([])
    expect(sent.outcome()).toBe('rejected')
    expect(calls.error).toHaveBeenCalledTimes(1)
  })

  it('does not report a queued message "not sent" after the turn end posted it while its own status read was out', async () => {
    state.working = true
    render()
    const reads = holdStatusReads()
    const sent = await tap('and then the lint')
    await turnEnds()
    await reads.answer(1, 'connected') // the turn end reads first and posts the entry
    expect(postedTexts().map((post) => post.text)).toEqual(['and then the lint'])
    await reads.answer(0, 'disconnected') // the computer drops before the tap's own read answers
    expect(postedTexts()).toHaveLength(1)
    expect(composer.text).toBe('')
    expect(sent.outcome()).toBe('accepted')
  })

  // Uncertainty 6.
  it('gives back two identical queued messages with one offline notice', async () => {
    state.working = true
    render()
    const reads = holdStatusReads()
    await tap('ok')
    await tap('ok')
    expect(hook.api.queue).toEqual(['ok', 'ok'])
    await reads.answer(0, 'disconnected')
    await reads.answer(1, 'disconnected')
    expect(hook.api.queue).toEqual([])
    expect(composer.text).toBe('ok\n\nok')
    expect(calls.error).toHaveBeenCalledTimes(1)
  })

  it('gives back two queued messages with one offline notice when the later one\'s read answers first', async () => {
    state.working = true
    render()
    const reads = holdStatusReads()
    await tap('first')
    await tap('second')
    await reads.answer(1, 'disconnected')
    await reads.answer(0, 'disconnected')
    expect(composer.text).toBe('first\n\nsecond')
    expect(calls.error).toHaveBeenCalledTimes(1)
  })

  // Uncertainty 2: the composer itself blocks a second tap while onSend is out
  // (MobileNativeChatComposer.tsx `sendingRef`); a direct second call is what is left.
  it('keeps two messages queued during one status read as two entries, typed order', async () => {
    state.working = true
    render()
    const reads = holdStatusReads()
    const first = await tap('first')
    const second = await tap('second')
    await reads.answer(0, 'connected')
    await reads.answer(1, 'connected')
    expect(hook.api.queue).toEqual(['first', 'second'])
    expect(first.outcome()).toBe('accepted')
    expect(second.outcome()).toBe('accepted')
    expect(calls.error).not.toHaveBeenCalled()
  })

  it('refuses a second idle tap while the first one\'s status read is out, and posts the first once', async () => {
    const reads = holdStatusReads()
    const first = await tap('run the tests')
    const second = await tap('and the lint')
    expect(second.outcome()).toBe('rejected')
    expect(calls.error).toHaveBeenCalledWith(CCR_SEND_IN_FLIGHT)
    await reads.answer(0, 'connected')
    expect(postedTexts().map((post) => post.text)).toEqual(['run the tests'])
    expect(first.outcome()).toBe('accepted')
  })

  // Uncertainty 5: the origin is now captured at the tap, so a tab switch during the read.
  it('posts a message to the session of the tab it was typed on when the tab changes during its status read', async () => {
    const reads = holdStatusReads()
    const sent = await tap('run the tests')
    state.tabId = 'tab-b'
    render()
    await reads.answer(0, 'connected')
    expect(postedTexts()).toEqual([{ sessionId: CSE_A, text: 'run the tests', priority: undefined }])
    expect(sent.outcome()).toBe('accepted')
  })

  it('gives an offline message back to the tab it was typed on when the tab changes during its status read', async () => {
    const reads = holdStatusReads()
    await tap('run the tests')
    state.tabId = 'tab-b'
    render()
    await reads.answer(0, 'disconnected')
    expect(calls.restore).toHaveBeenCalledTimes(1)
    expect((calls.restore.mock.calls[0]?.[0] as { draftKey: string } | undefined)?.draftKey).toBe('draft:tab-a')
    expect(posts).toEqual([])
  })

  it('gives an offline queued message back to the draft of the tab it was typed on when the tab changes during its status read', async () => {
    state.working = true
    render()
    const reads = holdStatusReads()
    await tap('and then the lint')
    state.tabId = 'tab-b'
    render()
    await reads.answer(0, 'disconnected')
    expect(drafts['draft:tab-a']).toBe('and then the lint')
    expect(composer.text).toBe('')
    expect(posts).toEqual([])
  })

  it('takes the bubble down and gives the words back once when the POST fails after a status read drew it', async () => {
    const reads = holdStatusReads()
    io.post = async () => {
      throw new Error('socket hang up')
    }
    const sent = await tap('run the tests')
    await reads.answer(0, 'connected')
    expect(postedTexts()).toHaveLength(1)
    expect(sent.outcome()).toBe('rejected')
    expect(calls.accept).toHaveBeenCalledTimes(1)
    expect(calls.remove).toHaveBeenCalledTimes(1)
    expect(calls.restore).toHaveBeenCalledTimes(1)
    expect(calls.error).toHaveBeenCalledTimes(1)
    expect(calls.error.mock.calls[0]?.[1]).toEqual({ retry: true })
  })

  it('posts a queued message once, and does not also put it back, when the chat closes while its status read is out', async () => {
    state.working = true
    render()
    const reads = holdStatusReads()
    await tap('and then the lint')
    unmount()
    await reads.answer(0, 'disconnected')
    await flush()
    expect(postedTexts().map((post) => post.text)).toEqual(['and then the lint'])
    expect(restored).toEqual([])
  })

  it('sends two messages queued during status reads as two turns, the first alone at the turn end', async () => {
    state.working = true
    render()
    const reads = holdStatusReads()
    await tap('first')
    await tap('second')
    await reads.answer(0, 'connected')
    await reads.answer(1, 'connected')
    io.readStatus = async () => 'connected'
    await turnEnds()
    await flush()
    expect(postedTexts().map((post) => post.text)).toEqual(['first'])
    expect(hook.api.queue).toEqual(['second'])
  })
})

// ---------------------------------------------------------------------------------------------
// The real draft store and outbox
// ---------------------------------------------------------------------------------------------

const CSE = 'cse_01FaTuRHkvnrgXpjd3nuGiQF'
const ACCOUNT = 'acct-personal'
const DRAFT_KEY = 'h\0w\0tab-c'
const OLD = 'the message the killed app left behind'
const NEW = 'a new message typed after the relaunch'
type Body = ReturnType<typeof buildCcrUserEventBody>
const realPosts: { sessionId: string; body: Body }[] = []
const statusReads: ((status: string) => void)[] = []
const errors: string[] = []
let realUuids = 0
const realDeps: CcrComposerSendDeps = {
  post: async (_account, sessionId, body) => {
    realPosts.push({ sessionId, body })
  },
  readStatus: () => new Promise<string>((resolve) => statusReads.push(resolve)),
  log: () => undefined,
  newUuid: () => `uuid-${(realUuids += 1)}`,
  restoreDraft: async () => undefined
}
const view = { events: [] as CcrEvent[], working: false, connectionStatus: null as string | null, withOutbox: false }
type Screen = {
  send: (text: string) => Promise<MobileNativeChatSendOutcome>
  composerText: string
  setComposerText: (text: string) => void
  pending: readonly { text?: string; id?: string }[]
}
let screen: Screen | null = null

function OutboxBeside(props: { drafts: ReturnType<typeof useMobileNativeChatDrafts>; resend: (text: string, entry: NativeChatOutboxEntry) => Promise<MobileNativeChatSendOutcome> }): null {
  useMobileNativeChatOutbox({
    hostId: 'h', worktreeId: 'w', tabId: 'tab-c', sessionId: 'session-c', showNativeChat: true, structured: false, terminalChat: true, agent: 'claude', terminal: 'term-1',
    messages: [], transcriptSettled: true, receipts: [], inputSendable: true, agentWorking: view.working, promptUp: false, queuedCount: 0,
    composerText: props.drafts.composerText, setComposerText: props.drafts.setComposerText,
    sendTerminal: async () => 'accepted', sendStructured: async () => 'rejected', sendAnthropic: props.resend,
    showEcho: props.drafts.showOutboxEcho, removeEcho: props.drafts.removePending, onNotice: () => undefined
  })
  return null
}

function ChatScreen(): ReturnType<typeof createElement> | null {
  const chat = useMobileNativeChatDrafts({ hostId: 'h', worktreeId: 'w', tabId: 'tab-c', sessionId: 'session-c', messages: [], transcriptSettled: true })
  const ccr = useCcrComposerSend({
    active: true,
    tabId: 'tab-c',
    resolveTarget: () => ({ kind: 'target', sessionId: CSE, accountId: ACCOUNT }),
    events: view.events,
    connectionStatus: view.connectionStatus,
    working: view.working,
    promptUp: false,
    attachments: () => 0,
    composerText: chat.composerText,
    setComposerText: chat.setComposerText,
    captureSendOrigin: chat.captureSendOrigin,
    clearDraftForSend: chat.clearDraftForSend,
    acceptSend: chat.acceptSend,
    // As the controller passes it on this lane (use-mobile-native-chat-controller.ts).
    restoreRejectedDraft: chat.restoreRejectedDraft,
    returnQueueToDraft: chat.returnQueueToDraft,
    removePending: chat.removePending,
    onSendError: (message) => errors.push(message),
    deps: realDeps
  })
  screen = { send: ccr.sendWithOutcome, composerText: chat.composerText, setComposerText: (text) => chat.setComposerText(text), pending: chat.pending as unknown as Screen['pending'] }
  return view.withOutbox ? createElement(OutboxBeside, { drafts: chat, resend: ccr.resendFromOutbox }) : null
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
const realTexts = (): unknown[] => realPosts.map((post) => (post.body.events[0]?.payload.message as { content?: unknown } | undefined)?.content)

describe('bubble at tap, real draft store and outbox', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    realPosts.length = 0
    statusReads.length = 0
    errors.length = 0
    realUuids = 0
    Object.assign(view, { events: [], working: false, connectionStatus: null, withOutbox: false })
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
  async function settleAll(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 5; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    })
  }
  async function answerRead(status: string): Promise<void> {
    await act(async () => {
      statusReads.shift()?.(status)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await settleAll()
  }
  async function realTap(send: (text: string) => Promise<MobileNativeChatSendOutcome>, text: string): Promise<{ outcome: () => MobileNativeChatSendOutcome | null }> {
    let result: MobileNativeChatSendOutcome | null = null
    await act(async () => {
      void send(text).then((outcome) => (result = outcome))
      await Promise.resolve()
      await Promise.resolve()
    })
    return { outcome: () => result }
  }
  async function type(text: string): Promise<void> {
    await act(async () => {
      screen!.setComposerText(text)
      await Promise.resolve()
    })
  }

  it('keeps an idle message on disk exactly once, with its uuid, from the moment the box empties while the status read is out', async () => {
    await mount()
    await type('run the tests')
    await realTap(screen!.send, 'run the tests')
    expect(screen!.composerText).toBe('')
    const held = nativeChatOutboxEntries().filter((item) => item.text === 'run the tests')
    expect(held).toHaveLength(1)
    expect(held[0]!.ccr).toEqual({ sessionId: CSE, accountId: ACCOUNT, uuid: 'uuid-1' })
    await answerRead('connected')
    expect(realTexts()).toEqual(['run the tests'])
    expect(nativeChatOutboxEntries().filter((item) => item.text === 'run the tests')).toEqual([])
  })

  it('puts an offline idle message back in the composer once, with no bubble and no outbox entry left', async () => {
    await mount()
    await type('run the tests')
    const sent = await realTap(screen!.send, 'run the tests')
    await answerRead('disconnected')
    expect(sent.outcome()).toBe('rejected')
    expect(screen!.composerText).toBe('run the tests')
    expect(screen!.pending).toEqual([])
    expect(nativeChatOutboxEntries()).toEqual([])
    expect(realPosts).toEqual([])
    expect(errors).toEqual([CCR_REMOTE_CONTROL_OFFLINE])
  })

  // Uncertainty 7.
  // Pinned convention (coordinator, 2026-10-17): an idle message refused after its bubble was drawn
  // comes back through restoreRejectedDraft, which APPENDS after what was typed meanwhile, as a
  // failed POST's words always have (returnRejectedDraftWords); only a queued give-back goes ahead.
  it('appends an idle message that comes back offline after what was typed during its status read, as a failed POST does', async () => {
    await mount()
    await type('run the tests')
    await realTap(screen!.send, 'run the tests')
    await type('and the lint')
    await answerRead('disconnected')
    expect(screen!.composerText).toBe('and the lint\n\nrun the tests')
  })

  it('keeps the typed order when a queued message comes back offline after more was typed during its status read', async () => {
    view.working = true
    await mount()
    await type('run the tests')
    await realTap(screen!.send, 'run the tests')
    await type('and the lint')
    await answerRead('disconnected')
    expect(screen!.composerText).toBe('run the tests\n\nand the lint')
  })

  // Uncertainty 1: the image share ask goes through this send on the lane
  // (use-mobile-native-chat-controller.ts `shareSendRef`), and its words were never in the box.
  it('leaves the user\'s own draft alone when an image share ask is refused offline after its status read (idle)', async () => {
    await mount()
    await type('my own half-typed message')
    const ask = lockedShareAskSend({ handleRef: { current: null }, send: (text) => screen!.send(text), onSendError: (message) => errors.push(message) })
    const sent = await realTap(ask, shareAskText('/tmp/scratch/plot.png'))
    await answerRead('disconnected')
    expect(sent.outcome()).toBe('rejected')
    expect(screen!.composerText).toBe('my own half-typed message')
  })

  it('leaves the user\'s own draft alone when an image share ask is refused offline after its status read (Claude working)', async () => {
    view.working = true
    await mount()
    await type('my own half-typed message')
    const ask = lockedShareAskSend({ handleRef: { current: null }, send: (text) => screen!.send(text), onSendError: (message) => errors.push(message) })
    const sent = await realTap(ask, shareAskText('/tmp/scratch/plot.png'))
    await answerRead('disconnected')
    expect(sent.outcome()).toBe('rejected')
    expect(screen!.composerText).toBe('my own half-typed message')
  })

  // Uncertainty 4.
  it('draws a message the killed app left behind above the new one sent before the status read answers, and posts it first', async () => {
    vi.useFakeTimers()
    view.withOutbox = true
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([entry({})]))
    await mount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    await act(async () => {
      void screen!.send(NEW)
      await Promise.resolve()
    })
    const before = screen!.pending.map((row) => row.text)
    // At the tap, before the read answers: the recovered message is drawn, and above the new one.
    expect(before[0]).toBe(OLD)
    await act(async () => {
      statusReads.shift()?.('connected')
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(realTexts()).toEqual([OLD, NEW])
    const texts = screen!.pending.map((row) => row.text)
    expect(texts.indexOf(OLD)).toBeLessThan(texts.indexOf(NEW))
    expect(!before.includes(NEW) || before.indexOf(NEW) > 0).toBe(true)
  })
})
