// Reported 2026-10-11, on 0.9.128: "A text message that times out while you're in another chat is
// sent once when you come back. All messages must be send reliability and must not drop".
//
// Until then a message the phone could not confirm waited in the outbox for its own chat to be
// shown again: only that chat's recovery sent it. A photo said "Delivery unconfirmed" and was
// given up on. The app-wide drainer (native-chat-outbox-drainer.ts) sends every chat's entries
// as soon as the link is up, whatever is on screen, and on a structured session every attempt
// carries the entry's one operation id, so the host's ledger answers a repeat instead of posting
// the message twice.
//
// Drives the REAL draft store, the REAL structured send bridge, the REAL outbox recovery and the
// REAL drainer. The desktop is a ledger: one post per operation id, as the host keeps it.

import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
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
  type NativeChatOutboxAttachment,
  type NativeChatOutboxEntry
} from '../storage/native-chat-outbox'
import { mountOutboxDrainer, resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { resetNativeChatSendTimingForTests } from './native-chat-send-timing'
import { resetAppForegroundClockForTests } from './app-foreground-clock'
import { createOutboxDrainer, type OutboxDrainer } from './native-chat-outbox-drainer'
import { OUTBOX_DRAIN_SESSION_ATTEMPTS } from './native-chat-outbox-drain-plan'

const TEXT = 'what is in this screenshot'
const PHOTO = 'file:///a.jpg'
const UPLOADED: NativeChatOutboxAttachment = { path: '/tmp/orca-paste-1.png', previewUri: PHOTO }
const connectedClient = { getState: () => 'connected', notifyForeground: vi.fn() } as unknown as RpcClient

type Request = { text: string; operationId: string | undefined; attachments: readonly NativeChatOutboxAttachment[] }

describe('a message the phone could not confirm, with its chat not on screen', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
  let bridge: ReturnType<typeof useMobileStructuredNativeChatSendBridge> | null = null
  let drainer: OutboxDrainer | null = null
  let unmountDrainer: (() => void) | null = null
  let shown = false
  let linkUp = true
  const errors: string[] = []
  const logs: { level: string; message: string; detail: string }[] = []
  /** Every request that reached the desktop, the press's and the drainer's. */
  const requests: Request[] = []
  /** What the agent got: one post per operation id (the host's ledger). */
  const posted = new Map<string, string>()
  /** How the desktop answers the press: by default the answer is lost after it posted. */
  let pressAnswer: (request: Request) => Promise<MobileNativeChatSendOutcome> = async (request) => {
    post(request)
    return 'unknown'
  }
  /** How the desktop answers the drainer: it posts unless the ledger already holds the id. */
  let drainAnswer: (request: Request) => Promise<MobileNativeChatSendOutcome> = async (request) => {
    post(request)
    return 'accepted'
  }

  function post(request: Request): void {
    if (request.operationId && !posted.has(request.operationId)) {
      posted.set(request.operationId, request.text)
    }
  }

  beforeEach(() => {
    errors.length = 0
    logs.length = 0
    requests.length = 0
    posted.clear()
    shown = false
    linkUp = true
    pressAnswer = async (request) => {
      post(request)
      return 'unknown'
    }
    drainAnswer = async (request) => {
      post(request)
      return 'accepted'
    }
    resetAppForegroundClockForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    resetNativeChatSendTimingForTests()
  })
  afterEach(async () => {
    stopDrainer()
    vi.clearAllTimers()
    vi.useRealTimers()
    act(() => renderer?.unmount())
    renderer = null
    resetLiveNativeChatDraftsForTests()
    resetAppForegroundClockForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    await clearNativeChatDraftStores()
    await AsyncStorage.clear()
  })

  const messages: NativeChatMessage[] = []

  function ChatScreen(): null {
    drafts = useMobileNativeChatDrafts({
      hostId: 'h',
      worktreeId: 'w',
      tabId: 'tab-s',
      sessionId: 'session-s',
      messages,
      transcriptSettled: true
    })
    bridge = useMobileStructuredNativeChatSendBridge({
      agent: 'claude',
      sendStructured: (text, _images, _deadline, attachments, operationId) => {
        const request = { text, operationId, attachments: attachments ?? [] }
        requests.push(request)
        return pressAnswer(request)
      },
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
      // Another tab of the worktree is shown: the controller stays mounted, its chat view does not.
      showNativeChat: shown,
      structured: true,
      terminalChat: false,
      agent: 'claude',
      messages,
      transcriptSettled: true,
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
  function startDrainer(): void {
    unmountDrainer = mountOutboxDrainer()
    drainer = createOutboxDrainer({
      now: () => Date.now(),
      connectedClient: () => (linkUp ? connectedClient : null),
      observe: async () => ({ kind: 'busy' }),
      send: async (_client, entry) => {
        const request = { text: entry.text, operationId: entry.operationId, attachments: entry.attachments ?? [] }
        requests.push(request)
        return drainAnswer(request)
      },
      setTimer: (ms, run) => {
        const timer = setTimeout(run, ms)
        return () => clearTimeout(timer)
      },
      log: (_hostId, line) => logs.push(line)
    })
    drainer.kick({ fresh: true })
  }
  function stopDrainer(): void {
    drainer?.stop()
    drainer = null
    unmountDrainer?.()
    unmountDrainer = null
  }
  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
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
  async function pressPhoto(): Promise<void> {
    await act(async () => {
      drafts!.setComposerText(TEXT)
    })
    await act(async () => {
      drafts!.clearDraftAtSendStart(TEXT, [PHOTO])
      void bridge!.sendWithOutcome(TEXT, [PHOTO], undefined, [UPLOADED])
      await vi.advanceTimersByTimeAsync(0)
    })
  }
  /** Android kills the process: no effect cleanup runs; only storage survives. */
  async function kill(): Promise<void> {
    await advance(0)
    stopDrainer()
    vi.clearAllTimers()
    resetLiveNativeChatDraftsForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    resetNativeChatSendTimingForTests()
    act(() => renderer?.unmount())
    renderer = null
  }
  const postedTexts = (): string[] => [...posted.values()]

  it('sends a text whose hold runs out while another chat is on screen, without its chat being opened', async () => {
    vi.useFakeTimers()
    // The press's answer is lost and the message never reached the agent.
    pressAnswer = async () => 'unknown'
    startDrainer()
    mount()
    await pressText()
    // The hold runs out (20 s of foreground time) and the drainer sends it straight away.
    await advance(25_000)

    expect(postedTexts()).toEqual([TEXT])
    expect(nativeChatOutboxEntries()).toEqual([])
    expect(errors).toEqual([])
    expect(shown).toBe(false)
  })

  it('posts it once when the press did arrive and only its answer was lost', async () => {
    vi.useFakeTimers()
    startDrainer()
    mount()
    await pressText()
    await advance(25_000)

    // The drainer's attempt carried the press's own operation id: the ledger answered it.
    expect(requests.map((request) => request.operationId)).toEqual([requests[0]!.operationId, requests[0]!.operationId])
    expect(postedTexts()).toEqual([TEXT])
    expect(nativeChatOutboxEntries()).toEqual([])
    await advance(120_000)
    expect(requests).toHaveLength(2)
  })

  it('sends nothing while the original send is still out, and nothing at all once its late answer says it arrived', async () => {
    vi.useFakeTimers()
    let answer: (outcome: MobileNativeChatSendOutcome) => void = () => {}
    pressAnswer = (request) => {
      post(request)
      return new Promise((resolve) => {
        answer = resolve
      })
    }
    startDrainer()
    mount()
    await pressText()
    await advance(40_000)
    expect(requests).toHaveLength(1)

    await act(async () => {
      answer('accepted')
      await vi.advanceTimersByTimeAsync(0)
    })
    await advance(120_000)
    expect(requests).toHaveLength(1)
    expect(postedTexts()).toEqual([TEXT])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('sends a photo once after an app restart, with its uploaded paths, under the press’s id', async () => {
    vi.useFakeTimers()
    // The press reached the desktop and the process died before the answer came back.
    pressAnswer = (request) => {
      post(request)
      return new Promise(() => {})
    }
    mount()
    await pressPhoto()
    const pressId = requests[0]!.operationId
    expect(nativeChatOutboxEntries()[0]!.attachments).toEqual([UPLOADED])
    await kill()

    // The app starts again with no chat open.
    startDrainer()
    await advance(5_000)

    expect(requests.map((request) => request.operationId)).toEqual([pressId, pressId])
    expect(requests[1]!.attachments).toEqual([UPLOADED])
    expect(postedTexts()).toEqual([TEXT])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('says nothing about a photo whose hold runs out on screen, and the drainer sends it', async () => {
    vi.useFakeTimers()
    shown = true
    pressAnswer = async () => 'unknown'
    startDrainer()
    mount()
    await pressPhoto()
    await advance(30_000)

    expect(errors).toEqual([])
    expect(postedTexts()).toEqual([TEXT])
    expect(requests.at(-1)!.attachments).toEqual([UPLOADED])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('waits while the link is down and sends on the next connection', async () => {
    vi.useFakeTimers()
    pressAnswer = async () => 'unknown'
    linkUp = false
    startDrainer()
    mount()
    await pressText()
    await advance(120_000)
    expect(requests).toHaveLength(1)
    expect(nativeChatOutboxEntries()).toHaveLength(1)
    expect(nativeChatOutboxEntries()[0]!.failed).toBeUndefined()

    linkUp = true
    // What the root's connection watch does on a new connection.
    drainer!.kick({ fresh: true })
    await advance(1_000)
    expect(postedTexts()).toEqual([TEXT])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('keeps the message as "Not sent" after the desktop refuses every try, with a bounded log', async () => {
    vi.useFakeTimers()
    pressAnswer = async () => 'unknown'
    drainAnswer = async () => 'rejected'
    startDrainer()
    mount()
    await pressText()
    await advance(30 * 60_000)

    expect(requests).toHaveLength(1 + OUTBOX_DRAIN_SESSION_ATTEMPTS)
    const [kept] = nativeChatOutboxEntries()
    expect(kept).toMatchObject({ text: TEXT, failed: true, failedReason: 'attempts' })
    // One line when it gives up; none per try.
    expect(logs).toHaveLength(1)
    expect(logs[0]!.level).toBe('warn')
    expect(logs[0]!.detail).not.toContain(TEXT)
    // A given-up entry is not tried again by itself.
    await advance(30 * 60_000)
    expect(requests).toHaveLength(1 + OUTBOX_DRAIN_SESSION_ATTEMPTS)
  })

  it('sends nothing when the try cannot be counted on disk first', async () => {
    vi.useFakeTimers()
    pressAnswer = async () => 'unknown'
    startDrainer()
    mount()
    await pressText()
    await advance(10_000)
    const setItem = vi.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('disk full'))
    try {
      await advance(60_000)
      expect(requests).toHaveLength(1)
      expect(postedTexts()).toEqual([])
    } finally {
      setItem.mockRestore()
    }
    // The store takes writes again: the next try is counted, and goes.
    drainer!.kick({ fresh: true })
    await advance(5_000)
    expect(postedTexts()).toEqual([TEXT])
  })
})

describe('the drainer at the degenerate sizes', () => {
  let drainer: OutboxDrainer | null = null
  let unmount: (() => void) | null = null
  const sends: NativeChatOutboxEntry[] = []
  const logs: unknown[] = []

  beforeEach(() => {
    sends.length = 0
    logs.length = 0
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
  })
  afterEach(async () => {
    drainer?.stop()
    unmount?.()
    vi.clearAllTimers()
    vi.useRealTimers()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    await AsyncStorage.clear()
  })

  function start(): void {
    unmount = mountOutboxDrainer()
    drainer = createOutboxDrainer({
      now: () => Date.now(),
      connectedClient: () => connectedClient,
      observe: async () => ({ kind: 'clear', terminal: 'term-1' }),
      send: async (_client, entry) => {
        sends.push(entry)
        return 'accepted'
      },
      setTimer: (ms, run) => {
        const timer = setTimeout(run, ms)
        return () => clearTimeout(timer)
      },
      log: (_hostId, line) => logs.push(line)
    })
    drainer.kick({ fresh: true })
  }

  function stored(overrides: Partial<NativeChatOutboxEntry>): NativeChatOutboxEntry {
    return {
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
      autoAttempts: 0,
      route: {
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-s',
        lane: 'session',
        agent: 'claude',
        sessionId: 'session-s',
        terminal: null,
        transcriptPath: null
      },
      ...overrides
    }
  }

  it('does nothing with an empty outbox: no send, no line, no timer', async () => {
    vi.useFakeTimers()
    start()
    await vi.advanceTimersByTimeAsync(0)
    await drainer!.idle()
    expect(sends).toEqual([])
    expect(logs).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('sends the one stored entry once at start, and the second chat’s too', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem(
      'orca:chatOutbox',
      JSON.stringify([stored({}), stored({ id: 'send-2', draftKey: 'h\0w\0tab-t', operationId: 'op-2' })])
    )
    start()
    await vi.advanceTimersByTimeAsync(1_000)
    await drainer!.idle()
    expect(sends.map((entry) => entry.id)).toEqual(['send-1', 'send-2'])
    expect(nativeChatOutboxEntries()).toEqual([])
    await vi.advanceTimersByTimeAsync(120_000)
    expect(sends).toHaveLength(2)
  })

  it('sends two messages of one chat in the order they were sent', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem(
      'orca:chatOutbox',
      JSON.stringify([
        stored({ id: 'second', operationId: 'op-2', createdAt: Date.now() - 30_000 }),
        stored({ id: 'first', operationId: 'op-1', createdAt: Date.now() - 60_000 })
      ])
    )
    start()
    await vi.advanceTimersByTimeAsync(1_000)
    await drainer!.idle()
    expect(sends.map((entry) => entry.id)).toEqual(['first', 'second'])
  })

  it('leaves an entry an older build wrote (no route) for its chat, and still sends the next one', async () => {
    vi.useFakeTimers()
    const { route: _route, ...legacy } = stored({ id: 'legacy', createdAt: Date.now() - 90_000 })
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([legacy, stored({ id: 'new', operationId: 'op-2' })]))
    start()
    await vi.advanceTimersByTimeAsync(1_000)
    await drainer!.idle()
    expect(sends.map((entry) => entry.id)).toEqual(['new'])
    expect(nativeChatOutboxEntries().map((entry) => entry.id)).toEqual(['legacy'])
  })
})
