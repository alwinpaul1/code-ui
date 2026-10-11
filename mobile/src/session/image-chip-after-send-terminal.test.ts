// Reported 2026-10-11 on 0.9.128 (screenshot from the phone, Claude Code tab "codeui", two
// background tasks running): a pasted screenshot sent with "Am using latest released version"
// showed in the sent bubble, its chip was still in the composer, and the phone said "Delivery
// unconfirmed". The session's transcript has no such message, and its photo numbering skips
// #57 (#56, then "[Image #58] Image staying"): the photo was pasted into Claude's input and its
// words typed, and the Enter never submitted them. Claude's own check found the words still in
// the input and could not call it sent; the hold ran out, and a photo send then said "Delivery
// unconfirmed" and was given up on, the message left on the desk's input line.
//
// These drive the REAL draft store, the REAL message send, the REAL image hook and the REAL
// outbox (and its drainer) against a fake desktop Claude Code tab that swallows the Enter of a
// photo send while it is busy. Screens: Claude Code 2.1.296 at 46 columns, captured 2026-10-09
// (send-exit-outbox-terminal.test.ts); the working row is the one that capture draws.

import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { resetLiveNativeChatDraftsForTests } from './mobile-native-chat-live-drafts'
import { resetAppForegroundClockForTests } from './app-foreground-clock'
import { baseArgs, ok } from './use-mobile-native-chat-image-attachments.test-support'
import { useMobileNativeChatOutbox } from './use-mobile-native-chat-outbox'
import { nativeChatOutboxEntries, resetNativeChatOutboxForTests } from '../storage/native-chat-outbox'
import { mountOutboxDrainer, resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { resetNativeChatSendTimingForTests } from './native-chat-send-timing'
import { createOutboxDrainer, type OutboxDrainer } from './native-chat-outbox-drainer'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { nativeChatOutboxDrainDeps } from './native-chat-outbox-drain-deps'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { BeaconPromptReceipt } from './mobile-native-chat-beacon-confirm'

vi.mock('../platform/media-picker', () => ({ useMediaPicker: () => ({ pickImages: vi.fn() }) }))
vi.mock('./mobile-image-source-picker', () => ({ pickMobileDocuments: vi.fn(), pickMobileImageFiles: vi.fn() }))
vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => false),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))
vi.mock('../background/background-link', () => ({ getBackgroundLinkWatcher: () => ({ peekClient: () => null }) }))

// ─── Claude Code 2.1.296, 46 columns, captured 2026-10-09 ────────────────────
const RULE = '─'.repeat(46)
const STATUS = [
  '                                          [-]',
  '  Haiku 5.5 medium │ ◔ — ',
  '  ◷ 5h 4% │ Sat 3:20 AM  ',
  '  ▦ 7d 45% │ Wed 7:00 PM '
]
const FOOTER = '  ⏵⏵ auto mode on (shift+tab to cycle)'
const WORKING = '✽ Sock-hopping… (1s · thinking)'
const screen = (input: string, working: boolean, sent: string | undefined): string[] => [
  ...(sent !== undefined ? [`❯ ${sent}`] : []),
  ...(working ? [WORKING] : []),
  ...STATUS,
  RULE,
  `❯ ${input}`,
  RULE,
  FOOTER
]

const TEXT = 'Am using latest released version'
const SCOPE = 'h\0w\0tab-a'
/** The keyboard's paste, uploaded: the desktop temp file Claude reads. */
const PASTED: PendingNativeChatImage = {
  id: 'img-57',
  path: '/var/folders/0y/T/orca-paste-1791708000000-aaaa.png',
  previewUri: 'file:///data/cache/rich-paste/paste-1.png'
}

type Desk = {
  client: RpcClient
  /** Each submission Claude took, as typed. */
  submitted: string[]
  /** Enters Claude swallows while it reads a pasted photo. */
  swallowEnters: number
  working: boolean
  transcript: NativeChatMessage[]
  /** The desktop refuses the photo's paste: nothing is submitted. */
  refusePaste: boolean
  /** Claude takes the message and the link drops before the answer comes back. */
  loseAnswer: boolean
  /** The prompt copies Orca's UserPromptSubmit hook put on the tab status, one per submission,
   *  newest last; the chat reads them through this same array as they land. */
  copies: BeaconPromptReceipt[]
}

function userRow(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}

function desktop(): Desk {
  let input = ''
  let photos = 56
  const desk: Desk = {
    client: null as unknown as RpcClient,
    submitted: [],
    swallowEnters: 0,
    working: true,
    refusePaste: false,
    loseAnswer: false,
    copies: [],
    transcript: [userRow('u-0', 'earlier'), { id: 'a-0', role: 'assistant', blocks: [{ type: 'text', text: 'ok' }], timestamp: null, source: 'transcript' }]
  }
  desk.client = {
    getState: () => 'connected',
    notifyForeground: vi.fn(),
    getLastConnectedAt: () => 1,
    subscribe: vi.fn((method: string, _params: unknown, onData: (frame: unknown) => void) => {
      if (method === 'nativeChat.subscribe') {
        const rows = [...desk.transcript]
        setTimeout(() => onData({ type: 'snapshot', messages: rows, hasMore: false }), 10)
      }
      return () => {}
    }),
    sendRequest: vi.fn(async (method: string, params: { text?: string; enter?: boolean }) => {
      if (method === 'session.tabs.list') {
        return ok('t', {
          worktree: 'w',
          snapshotVersion: 1,
          activeTabId: 'tab-a',
          activeTabType: 'terminal',
          tabs: [
            {
              type: 'terminal',
              id: 'tab-a',
              title: 'codeui',
              terminal: 'term-1',
              isActive: true,
              agentStatus: {
                state: desk.working ? 'working' : 'done',
                prompt: 'earlier',
                updatedAt: 1,
                stateStartedAt: 1,
                paneKey: 'tab-a:leaf',
                agentType: 'claude',
                stateHistory: [],
                providerSession: { key: 'claude', id: 'session-1' }
              }
            }
          ]
        })
      }
      if (method === 'terminal.read') {
        return ok('r', {
          terminal: { source: 'screen', tail: screen(input, desk.working, desk.submitted.at(-1)), draft: input }
        })
      }
      if (method === 'terminal.send') {
        const text = params.text ?? ''
        const keys = [...text].every((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)
        if (text.includes('\x15') || (keys && text.length > 0 && params.enter !== true)) {
          input = ''
        }
        if (text.includes(PASTED.path)) {
          if (desk.refusePaste) {
            return ok('s', { send: { accepted: false } })
          }
          photos += 1
          input = `${input}[Image #${photos}] `
          return ok('s', { send: { accepted: true } })
        }
        if (params.enter === true) {
          if (!keys) {
            input = `${input}${text}`
          }
          if (desk.swallowEnters > 0) {
            // Claude is still reading the pasted file: the Return is dropped, the words stay.
            desk.swallowEnters -= 1
            return ok('s', { send: { accepted: true } })
          }
          if (input.trim() !== '') {
            const taken = input.trim()
            desk.submitted.push(taken)
            const n = desk.submitted.length
            desk.copies.push({ nonce: `status:session-1:${n}`, text: taken })
            // The rows as Claude Code writes them (this session's own transcript, 2026-10-11):
            // the prompt " [Image #58] Image staying", then its companion naming the pasted file.
            desk.transcript = [
              ...desk.transcript,
              userRow(`u-${n}`, ` ${taken}`),
              ...(taken.includes('[Image #') ? [userRow(`u-${n}-src`, `[Image: source: ${PASTED.path}]`)] : [])
            ]
          }
          input = ''
          if (desk.loseAnswer) {
            throw markRpcDeliveryUnknown(new Error('relay RPC timed out: terminal.send'))
          }
          return ok('s', { send: { accepted: true } })
        }
        if (!keys) {
          input = `${input}${text}`
        }
        return ok('s', { send: { accepted: true } })
      }
      return ok('x', null)
    })
  } as unknown as RpcClient
  return desk
}

describe('a pasted screenshot sent to a busy Claude tab', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
  let images: ReturnType<typeof useMobileNativeChatImageAttachments> | null = null
  let drainer: OutboxDrainer | null = null
  let unmountDrainer: (() => void) | null = null
  let desk: Desk = desktop()
  const errors: string[] = []

  beforeEach(() => {
    errors.length = 0
    desk = desktop()
    resetAppForegroundClockForTests()
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    resetNativeChatSendTimingForTests()
    useNativeChatImageAttachmentsStore.getState().reset()
  })
  afterEach(async () => {
    drainer?.stop()
    drainer = null
    unmountDrainer?.()
    unmountDrainer = null
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

  let Screen: (() => null) | null = null
  /** The agent's turn ends: the tab's status and the screen say so, and the chat re-renders. */
  async function turnEnds(): Promise<void> {
    desk.working = false
    await act(async () => {
      renderer!.update(createElement(Screen!))
    })
  }
  function mount(): void {
    function ChatScreen(): null {
      drafts = useMobileNativeChatDrafts({
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-a',
        sessionId: 'session-1',
        messages: desk.transcript,
        transcriptSettled: true
      })
      const send = useMobileNativeChatMessageSend({
        client: desk.client,
        enabled: true,
        handleRef: { current: 'term-1' },
        deviceTokenRef: { current: null },
        agentRef: { current: 'claude' },
        commandSendRef: { current: vi.fn() },
        captureSendOrigin: drafts.captureSendOrigin,
        readSeededLaunchDraftSeed: () => null,
        clearDraftForSend: drafts.clearDraftForSend,
        restoreRejectedDraft: drafts.restoreRejectedDraft,
        showSendingEcho: drafts.showSendingEcho,
        acceptSend: drafts.acceptSend,
        holdUnconfirmedSend: drafts.holdUnconfirmedSend,
        onSendError: (message) => errors.push(message),
        promptReceipts: desk.copies
      })
      images = useMobileNativeChatImageAttachments(
        baseArgs({
          client: desk.client,
          agent: 'claude',
          scopeKey: SCOPE,
          hostTerminalOfTab: () => 'term-1',
          beginImageSend: drafts.clearDraftAtSendStart,
          onSendError: (message) => errors.push(message),
          baseSend: (text, previews, deadline, _attachments, follow) => send.sendWithOutcome(text, previews, deadline, follow)
        })
      )
      useMobileNativeChatOutbox({
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-a',
        sessionId: 'session-1',
        showNativeChat: true,
        structured: false,
        terminalChat: true,
        agent: 'claude',
        terminal: 'term-1',
        transcriptPath: null,
        promptBefore: 'earlier',
        messages: desk.transcript,
        transcriptSettled: true,
        receipts: [],
        inputSendable: true,
        agentWorking: desk.working,
        promptUp: false,
        queuedCount: 0,
        composerText: drafts.composerText,
        setComposerText: drafts.setComposerText,
        sendTerminal: (text) => send.sendWithOutcome(text),
        sendStructured: async () => 'rejected',
        showEcho: drafts.showOutboxEcho,
        removeEcho: drafts.removePending,
        onNotice: (message) => errors.push(message)
      })
      return null
    }
    Screen = ChatScreen
    act(() => {
      renderer = create(createElement(ChatScreen))
    })
  }

  function startDrainer(): void {
    unmountDrainer = mountOutboxDrainer()
    drainer = createOutboxDrainer({ ...nativeChatOutboxDrainDeps, connectedClient: () => desk.client, log: () => {} })
    drainer.kick({ fresh: true })
  }

  async function advance(ms: number): Promise<void> {
    for (let ran = 0; ran < ms; ran += 250) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(Math.min(250, ms - ran))
      })
    }
  }

  async function pasteAndSend(): Promise<void> {
    act(() => {
      useNativeChatImageAttachmentsStore.getState().update(() => ({ [SCOPE]: [PASTED] }))
    })
    await act(async () => {
      drafts!.setComposerText(TEXT)
    })
    await act(async () => {
      void images!.sendNativeChat(TEXT)
      await vi.advanceTimersByTimeAsync(0)
    })
  }

  const chips = (): string[] => (useNativeChatImageAttachmentsStore.getState().byScope[SCOPE] ?? []).map((chip) => chip.id)

  it('takes the chip out of the composer at once and never puts it back, whatever the send ends as', async () => {
    vi.useFakeTimers()
    desk.swallowEnters = 1
    startDrainer()
    mount()
    await pasteAndSend()
    expect(chips()).toEqual([])
    expect(drafts!.composerText).toBe('')
    await advance(5 * 60_000)
    expect(chips()).toEqual([])
    expect(drafts!.composerText).toBe('')
  })

  it('keeps a screenshot pasted while the send was on its way', async () => {
    vi.useFakeTimers()
    desk.swallowEnters = 1
    mount()
    await pasteAndSend()
    const later: PendingNativeChatImage = { ...PASTED, id: 'img-58', previewUri: 'file:///data/cache/rich-paste/paste-2.png' }
    act(() => {
      useNativeChatImageAttachmentsStore.getState().update((prev) => ({ ...prev, [SCOPE]: [...(prev[SCOPE] ?? []), later] }))
    })
    await advance(60_000)
    expect(chips()).toEqual(['img-58'])
  })

  it('puts the screenshot and the words back once when the desktop refuses its paste, and keeps a later one', async () => {
    vi.useFakeTimers()
    desk.refusePaste = true
    mount()
    await pasteAndSend()
    const later: PendingNativeChatImage = { ...PASTED, id: 'img-58', previewUri: 'file:///data/cache/rich-paste/paste-2.png' }
    act(() => {
      useNativeChatImageAttachmentsStore.getState().update((prev) => ({ ...prev, [SCOPE]: [...(prev[SCOPE] ?? []), later] }))
    })
    await advance(30_000)
    expect(chips()).toEqual(['img-57', 'img-58'])
    expect(drafts!.composerText).toBe(TEXT)
    expect(desk.submitted).toEqual([])
  })

  it('takes the rows of a photo send Claude took as its delivery when the answer was lost: no notice, no resend', async () => {
    vi.useFakeTimers()
    desk.loseAnswer = true
    startDrainer()
    mount()
    await pasteAndSend()
    await advance(3_000)
    desk.loseAnswer = false
    await advance(30_000)
    await turnEnds()
    await advance(5 * 60_000)

    expect(desk.submitted).toHaveLength(1)
    expect(errors).toEqual([])
    expect(nativeChatOutboxEntries()).toEqual([])
    expect(chips()).toEqual([])
  })

  it('presses Return once more when Claude dropped it, so the message goes at once, while it works', async () => {
    vi.useFakeTimers()
    desk.swallowEnters = 1
    mount()
    await pasteAndSend()
    // No drainer and no turn end: the send itself sees its words still in the input.
    await advance(15_000)

    expect(desk.submitted).toHaveLength(1)
    expect(desk.submitted[0]).toContain(TEXT)
    await advance(60_000)
    expect(desk.submitted).toHaveLength(1)
    expect(errors).toEqual([])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('degenerate: a Return dropped twice is held, not typed a third time, and the drainer finishes it once', async () => {
    vi.useFakeTimers()
    desk.swallowEnters = 2
    startDrainer()
    mount()
    await pasteAndSend()
    await advance(30_000)
    expect(desk.submitted).toEqual([])
    await turnEnds()
    await advance(5 * 60_000)
    expect(desk.submitted).toHaveLength(1)
    expect(errors).toEqual([])
  })

  it('submits it once when Claude dropped the Return of a photo send, and says nothing', async () => {
    vi.useFakeTimers()
    desk.swallowEnters = 1
    startDrainer()
    mount()
    await pasteAndSend()
    await advance(30_000)
    await turnEnds()
    await advance(5 * 60_000)

    expect(desk.submitted).toHaveLength(1)
    expect(desk.submitted[0]).toContain(TEXT)
    expect(errors).toEqual([])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('never sends again, nor says "Delivery unconfirmed", a photo send Claude took', async () => {
    vi.useFakeTimers()
    startDrainer()
    mount()
    await pasteAndSend()
    await advance(30_000)
    await turnEnds()
    await advance(5 * 60_000)

    expect(desk.submitted).toHaveLength(1)
    expect(errors).toEqual([])
    expect(nativeChatOutboxEntries()).toEqual([])
  })
})
