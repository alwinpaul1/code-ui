// Reported 2026-10-11 with a screenshot, on that day's build: two screenshots attached from the
// + sheet of the chat composer, sent with a caption to a Claude Code 2.1.296 tab that was working
// ("Working · 4 running tasks"). The words left the box and a user card with both thumbnails was
// drawn, but both chips stayed in the composer, each with its X, above "Queue a message…". The
// message never reached Claude: the card was the phone's own echo.
//
// The chips, the words and the bubble are one message and move together: out at the tap, back
// together on a refusal. These pin that through the REAL draft store, the REAL message send and
// the REAL image hook against a fake desktop Claude Code tab, idle and working, one photo and
// two: a send Claude takes, a send that fails while the box empties, and a refused send.
// Screens: Claude Code 2.1.296 at 46 columns, captured 2026-10-09
// (send-exit-outbox-terminal.test.ts), as image-chip-after-send-terminal.test.ts draws them.

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
import { nativeChatOutboxEntries, resetNativeChatOutboxForTests, subscribeNativeChatOutbox } from '../storage/native-chat-outbox'
import { resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { resetNativeChatSendTimingForTests } from './native-chat-send-timing'
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

const TEXT = 'the queue box overlaps the composer in both of these'
const SCOPE = 'h\0w\0tab-a'
/** Two screenshots picked from the + sheet, uploaded: the desktop temp files Claude reads. */
const PHOTOS: PendingNativeChatImage[] = [
  { id: 'img-1', path: '/var/folders/0y/T/orca-upload-1791708000000-aaaa.png', previewUri: 'file:///data/cache/pick-1.png' },
  { id: 'img-2', path: '/var/folders/0y/T/orca-upload-1791708000001-bbbb.png', previewUri: 'file:///data/cache/pick-2.png' }
]

type Desk = {
  client: RpcClient
  /** Each submission Claude took, as typed. */
  submitted: string[]
  working: boolean
  transcript: NativeChatMessage[]
  /** Orca's UserPromptSubmit hook copies on the tab status, one per submission, newest last. */
  copies: BeaconPromptReceipt[]
  /** One relay round trip, per request. */
  latencyMs: number
  /** The desktop refuses the photos' paste: nothing is typed or submitted. */
  refusePaste: boolean
}

function userRow(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}

function desktop(working: boolean): Desk {
  let input = ''
  let photos = 56
  /** The photos pasted into the input since the last submission. */
  const onLine: PendingNativeChatImage[] = []
  const desk: Desk = {
    client: null as unknown as RpcClient,
    submitted: [],
    working,
    copies: [],
    latencyMs: 0,
    refusePaste: false,
    transcript: [userRow('u-0', 'earlier'), { id: 'a-0', role: 'assistant', blocks: [{ type: 'text', text: 'ok' }], timestamp: null, source: 'transcript' }]
  }
  desk.client = {
    getState: () => 'connected',
    notifyForeground: vi.fn(),
    getLastConnectedAt: () => 1,
    subscribe: vi.fn(() => () => {}),
    sendRequest: vi.fn(async (method: string, params: { text?: string; enter?: boolean }) => {
      if (desk.latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, desk.latencyMs))
      }
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
        const pasted = PHOTOS.filter((photo) => text.includes(photo.path))
        if (pasted.length > 0) {
          if (desk.refusePaste) {
            return ok('s', { send: { accepted: false } })
          }
          for (const photo of pasted) {
            photos += 1
            input = `${input}[Image #${photos}] `
            onLine.push(photo)
          }
          return ok('s', { send: { accepted: true } })
        }
        if (params.enter === true) {
          if (!keys) {
            input = `${input}${text}`
          }
          if (input.trim() !== '') {
            const taken = input.trim()
            desk.submitted.push(taken)
            const n = desk.submitted.length
            desk.copies.push({ nonce: `status:session-1:${n}`, text: taken })
            desk.transcript = [
              ...desk.transcript,
              userRow(`u-${n}`, ` ${taken}`),
              ...onLine.map((photo, index) => userRow(`u-${n}-src-${index}`, `[Image: source: ${photo.path}]`))
            ]
          }
          input = ''
          onLine.length = 0
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

describe('photos sent from the chat composer move with their words', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
  let images: ReturnType<typeof useMobileNativeChatImageAttachments> | null = null
  let desk: Desk = desktop(true)
  const errors: string[] = []

  beforeEach(() => {
    errors.length = 0
    resetAppForegroundClockForTests()
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    resetNativeChatSendTimingForTests()
    useNativeChatImageAttachmentsStore.getState().reset()
  })
  afterEach(async () => {
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
      return null
    }
    Screen = ChatScreen
    act(() => {
      renderer = create(createElement(ChatScreen))
    })
  }
  let Screen: (() => null) | null = null

  async function advance(ms: number): Promise<void> {
    for (let ran = 0; ran < ms; ran += 250) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(Math.min(250, ms - ran))
      })
    }
  }

  const chips = (): string[] => (useNativeChatImageAttachmentsStore.getState().byScope[SCOPE] ?? []).map((chip) => chip.id)

  /** Attaches `count` photos, types the caption and taps Send; resolves with the send's result. */
  async function attachAndSend(count: number): Promise<{ result: boolean | null }> {
    act(() => {
      useNativeChatImageAttachmentsStore.getState().update(() => ({ [SCOPE]: PHOTOS.slice(0, count) }))
    })
    await act(async () => {
      drafts!.setComposerText(TEXT)
    })
    const sent: { result: boolean | null } = { result: null }
    await act(async () => {
      void images!.sendNativeChat(TEXT).then((accepted) => {
        sent.result = accepted
      })
      await vi.advanceTimersByTimeAsync(0)
    })
    return sent
  }

  for (const working of [true, false]) {
    for (const count of [1, 2]) {
      const when = working ? 'while Claude works' : 'to an idle Claude'
      const what = count === 1 ? 'one photo' : 'two photos'
      it(`takes ${what} sent ${when} out of the composer with the words, and they stay out once the message is on record`, async () => {
        vi.useFakeTimers()
        desk = desktop(working)
        desk.latencyMs = 250 // the relayed floor (memory: relay findings 2026-09-11)
        mount()
        const sent = await attachAndSend(count)
        expect(chips()).toEqual([])
        expect(drafts!.composerText).toBe('')
        await advance(30_000)
        await act(async () => {
          renderer!.update(createElement(Screen!))
        })
        // Claude took it once, and the transcript has its row.
        expect(desk.submitted).toHaveLength(1)
        expect(desk.submitted[0]).toContain(TEXT)
        expect(desk.transcript.some((row) => row.role === 'user' && JSON.stringify(row.blocks).includes(TEXT))).toBe(true)
        expect(sent.result).toBe(true)
        expect(chips()).toEqual([])
        expect(drafts!.composerText).toBe('')
        expect(errors).toEqual([])
      })
    }
  }

  // A step of the box emptying that throws (here Orca's outbox store telling a listener, the
  // last thing the step does) used to leave the composer split: the words gone and the sent
  // bubble drawn, but the chips still there and nothing typed, because the chips were taken
  // only after that step returned and the undo was armed only after that. A message drawn as
  // sent that never reached Claude, with its photos still in the box (2026-10-11).
  for (const count of [1, 2]) {
    it(`keeps ${count === 1 ? 'one photo' : 'two photos'}, the words and no bubble together when the send fails while the box empties`, async () => {
      vi.useFakeTimers()
      desk = desktop(true)
      mount()
      const stop = subscribeNativeChatOutbox(() => {
        if (nativeChatOutboxEntries().some((entry) => entry.echoId !== undefined)) {
          throw new Error('listener failed')
        }
      })
      try {
        const sent = await attachAndSend(count)
        await advance(30_000)
        expect(sent.result).toBe(false)
        expect(desk.submitted).toEqual([])
        expect(chips()).toEqual(PHOTOS.slice(0, count).map((photo) => photo.id))
        expect(drafts!.composerText).toBe(TEXT)
        expect(drafts!.pending).toEqual([])
        expect(errors).toEqual(['Message not sent'])
      } finally {
        stop()
      }
    })
  }

  it('degenerate: a refused photo send puts the chips and the words back together', async () => {
    vi.useFakeTimers()
    desk = desktop(true)
    desk.refusePaste = true
    mount()
    const sent = await attachAndSend(1)
    await advance(30_000)
    expect(sent.result).toBe(false)
    expect(chips()).toEqual(['img-1'])
    expect(drafts!.composerText).toBe(TEXT)
    expect(drafts!.pending).toEqual([])
  })
})
