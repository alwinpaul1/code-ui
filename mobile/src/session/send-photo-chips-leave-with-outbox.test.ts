// Reported 2026-10-10 from the phone (0.9.127, a terminal Claude chat tab "codeui"): a
// screenshot and the words "Why not showing effort" were sent from the chat composer. The user
// bubble drew the photo and the words, the words left the box, and the photo's chip stayed in the
// composer's attachment row with its ×, above the empty field. 0.9.118 had fixed the same symptom
// (use-mobile-native-chat-image-attachments.sent-chips-leave.test.ts); the outbox that 0.9.127
// added (native-chat-outbox-sends.ts, use-native-chat-outbox-recovery.ts) is what that suite does
// not mount, so these drive the REAL draft store, message send, image hook AND outbox recovery
// together, wired as the chat controller wires them (showSendingEcho included).
//
// The desktop is a stand-in for Claude's input whose screens are MODELLED on the `[Image #N]`
// chip literal (see mobile-native-chat-submit-verify-photos.test.ts for its provenance).

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import type { RpcClient } from '../transport/rpc-client'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { resetLiveNativeChatDraftsForTests } from './mobile-native-chat-live-drafts'
import { baseArgs, methodNotFound, ok } from './use-mobile-native-chat-image-attachments.test-support'
import { useMobileNativeChatOutbox } from './use-mobile-native-chat-outbox'
import { nativeChatOutboxEntries, resetNativeChatOutboxForTests } from '../storage/native-chat-outbox'
import { resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { resetNativeChatSendTimingForTests } from './native-chat-send-timing'
import { resetAppForegroundClockForTests } from './app-foreground-clock'
import { useMobileStructuredNativeChatSendBridge } from './use-mobile-structured-native-chat-send-bridge'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'

const pick = vi.hoisted(() => vi.fn())
vi.mock('../platform/media-picker', () => ({ useMediaPicker: () => ({ pickImages: pick }) }))
vi.mock('./mobile-image-source-picker', () => ({
  pickMobileDocuments: vi.fn(),
  pickMobileImageFiles: vi.fn()
}))
vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => false),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))

const RULE = '─'.repeat(190)
const BELOW = '  ⏵⏵ auto mode on (shift+tab to cycle)'
const CAPTION = 'Why not showing effort'
const chips = (n: number): string => Array.from({ length: n }, (_, i) => `[Image #${i + 1}]`).join('')
const inputHolding = (n: number): string[] => ['⏺ Done.', RULE, `❯ ${chips(n)}`.trimEnd(), RULE, BELOW]
const sentRow = (n: number, caption: string): string[] => [
  `❯ ${chips(n)} ${caption}`.trimEnd(), '⏺ Looking.', RULE, '❯ ', RULE, BELOW
]

type Drafts = ReturnType<typeof useMobileNativeChatDrafts>
type Images = ReturnType<typeof useMobileNativeChatImageAttachments>

describe('a sent photo leaves the composer with the outbox mounted (terminal chat)', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: Drafts | null = null
  let images: Images | null = null
  const errors: string[] = []

  beforeEach(() => {
    pick.mockReset()
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
    vi.useRealTimers()
    act(() => renderer?.unmount())
    renderer = null
    drafts = null
    images = null
    resetLiveNativeChatDraftsForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    await clearNativeChatDraftStores()
  })

  function desktop(photos: number, accept = true, enterGate?: Promise<void>) {
    let uploads = 0
    let pasted = 0
    let typed = ''
    let entered = false
    const client = {
      getState: () => 'connected',
      notifyForeground: vi.fn(),
      getLastConnectedAt: () => 1,
      sendRequest: vi.fn(async (method: string, params: { text?: string; enter?: boolean }) => {
        if (method === 'terminal.send') {
          if (params.enter === true) {
            await enterGate
            if (!accept) {
              return ok('s', { send: { accepted: false } })
            }
            typed = params.text ?? ''
            entered = true
          } else if ((params.text ?? '').includes('.png')) {
            pasted += 1
          }
          return ok('s', { send: { accepted: true } })
        }
        if (method === 'terminal.read') {
          const tail = entered ? sentRow(photos, typed) : inputHolding(Math.min(pasted, photos))
          return ok('r', { terminal: { source: 'screen', tail, draft: '' } })
        }
        uploads += 1
        return uploads % 2 === 1 ? methodNotFound('start') : ok('save', `/tmp/orca-paste-${uploads}.png`)
      })
    }
    return client as unknown as RpcClient
  }

  function mount(client: RpcClient): void {
    function ChatScreen(): null {
      drafts = useMobileNativeChatDrafts({
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-a',
        sessionId: 'session-1',
        messages: [],
        transcriptSettled: true
      })
      const send = useMobileNativeChatMessageSend({
        client,
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
        onSendError: (message) => errors.push(message)
      })
      images = useMobileNativeChatImageAttachments(
        baseArgs({
          client,
          agent: 'claude',
          hostTerminalOfTab: () => 'term-1',
          beginImageSend: drafts.clearDraftAtSendStart,
          onSendError: (message) => errors.push(message),
          baseSend: (text, previews, deadline, _attachments, follow) =>
            send.sendWithOutcome(text, previews, deadline, follow)
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
        messages: [],
        transcriptSettled: true,
        receipts: [],
        inputSendable: true,
        agentWorking: false,
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
    act(() => {
      renderer = create(createElement(ChatScreen))
    })
  }

  /** `pasted`: a screenshot taken off the clipboard, which the picker names "Pasted image"
   *  (mobile-image-source-picker.ts pickFromClipboard), so its chip is a FILE chip whose path
   *  rides in the words, not a photo pasted into the agent's input. */
  async function attach(photos: number, pasted = false): Promise<void> {
    pick.mockResolvedValueOnce(
      Array.from({ length: photos }, (_, n) =>
        pasted
          ? { base64: 'AAAA', uri: 'data:image/png;base64,AAAA', name: 'Pasted image' }
          : { base64: 'AAAA', uri: `file:///phone/pick-${n}.jpg` }
      )
    )
    await act(async () => {
      await images!.attachImage('library')
    })
  }

  async function type(text: string): Promise<void> {
    await act(async () => {
      drafts!.setComposerText(text)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
  }

  async function tapSend(text: string): Promise<boolean> {
    vi.useFakeTimers()
    let sending: Promise<boolean> | null = null
    await act(async () => {
      sending = images!.sendNativeChat(text)
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    const sent = await sending!
    // The recovery keeps evaluating on its beat after the send: give it time to act.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    vi.useRealTimers()
    await act(async () => {
      await Promise.resolve()
    })
    return sent
  }

  it('takes the photo out of the composer when the photo and its words are sent', async () => {
    mount(desktop(1))
    await attach(1)
    await type(CAPTION)
    expect(images!.attachments).toHaveLength(1)

    expect(await tapSend(CAPTION)).toBe(true)

    expect(errors).toEqual([])
    expect(drafts!.composerText).toBe('')
    expect(images!.attachments).toEqual([])
    expect(drafts!.pending).toHaveLength(1)
    expect(drafts!.pending[0]!.images).toHaveLength(1)
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('still puts the photo and the words back when the desktop refuses the send', async () => {
    mount(desktop(1, false))
    await attach(1)
    await type(CAPTION)

    expect(await tapSend(CAPTION)).toBe(false)

    expect(images!.attachments).toHaveLength(1)
    expect(drafts!.composerText).toBe(CAPTION)
    expect(drafts!.pending).toEqual([])
  })

  describe('a screenshot pasted off the clipboard (a file chip)', () => {
    it('takes the screenshot out of the composer as the box empties, not when the send settles', async () => {
      let open = (): void => {}
      const enter = new Promise<void>((resolve) => {
        open = resolve
      })
      mount(desktop(0, true, enter))
      await attach(1, true)
      await type(CAPTION)
      expect(images!.attachments).toHaveLength(1)
      expect(images!.attachments[0]!.kind).toBe('file')

      vi.useFakeTimers()
      let sending: Promise<boolean> | null = null
      await act(async () => {
        sending = images!.sendNativeChat(CAPTION)
        await vi.advanceTimersByTimeAsync(0)
      })
      for (let step = 0; step < 50 && drafts!.composerText !== ''; step += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10)
        })
      }
      // The words have left and the bubble is up: the chip must have gone with them.
      expect(drafts!.composerText).toBe('')
      expect(drafts!.pending).toHaveLength(1)
      expect(images!.attachments).toEqual([])

      open()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })
      expect(await sending!).toBe(true)
      vi.useRealTimers()
      expect(images!.attachments).toEqual([])
      expect(drafts!.composerText).toBe('')
      expect(errors).toEqual([])
    })

    it('puts the screenshot and the words back when the desktop refuses the send', async () => {
      mount(desktop(0, false))
      await attach(1, true)
      await type(CAPTION)

      expect(await tapSend(CAPTION)).toBe(false)

      expect(images!.attachments).toHaveLength(1)
      expect(drafts!.composerText).toBe(CAPTION)
      expect(drafts!.pending).toEqual([])
    })
  })
})

describe('a sent photo or screenshot leaves the composer with the outbox mounted (structured session)', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: Drafts | null = null
  let images: Images | null = null
  const errors: string[] = []

  beforeEach(() => {
    pick.mockReset()
    errors.length = 0
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    resetNativeChatSendTimingForTests()
    useNativeChatImageAttachmentsStore.getState().reset()
  })
  afterEach(async () => {
    vi.useRealTimers()
    act(() => renderer?.unmount())
    renderer = null
    resetLiveNativeChatDraftsForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    await clearNativeChatDraftStores()
  })

  /** Uploads land; the session's send is held at `gate` and then ends `outcome`. */
  function session(outcome: MobileNativeChatSendOutcome, gate: Promise<void>) {
    let uploads = 0
    const client = {
      getState: () => 'connected',
      notifyForeground: vi.fn(),
      getLastConnectedAt: () => 1,
      sendRequest: vi.fn(async () => {
        uploads += 1
        return uploads % 2 === 1 ? methodNotFound('start') : ok('save', `/tmp/orca-paste-${uploads}.png`)
      })
    } as unknown as RpcClient
    const send = async (): Promise<MobileNativeChatSendOutcome> => {
      await gate
      return outcome
    }
    return { client, send }
  }

  function mount(desk: ReturnType<typeof session>): void {
    function ChatScreen(): null {
      drafts = useMobileNativeChatDrafts({
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-a',
        sessionId: 'session-1',
        messages: [],
        transcriptSettled: true
      })
      const bridge = useMobileStructuredNativeChatSendBridge({
        agent: 'claude',
        sendStructured: desk.send,
        sendConditions: { client: desk.client, sendable: true },
        captureSendOrigin: drafts.captureSendOrigin,
        clearDraftForSend: drafts.clearDraftForSend,
        acceptSend: drafts.acceptSend,
        holdUnconfirmedSend: drafts.holdUnconfirmedSend,
        restoreRejectedDraft: drafts.restoreRejectedDraft,
        showSendingEcho: drafts.showSendingEcho,
        onSendError: (message) => errors.push(message)
      })
      images = useMobileNativeChatImageAttachments(
        baseArgs({
          client: desk.client,
          agent: 'claude',
          structuredNativeChat: true,
          beginImageSend: drafts.clearDraftAtSendStart,
          onSendError: (message) => errors.push(message),
          baseSend: (text, previews, deadline, attachments) => bridge.sendWithOutcome(text, previews, deadline, attachments)
        })
      )
      useMobileNativeChatOutbox({
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-a',
        sessionId: 'session-1',
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
        onNotice: (message) => errors.push(message)
      })
      return null
    }
    act(() => {
      renderer = create(createElement(ChatScreen))
    })
  }

  async function attach(pasted: boolean): Promise<void> {
    pick.mockResolvedValueOnce([
      pasted
        ? { base64: 'AAAA', uri: 'data:image/png;base64,AAAA', name: 'Pasted image' }
        : { base64: 'AAAA', uri: 'file:///phone/pick-0.jpg' }
    ])
    await act(async () => {
      await images!.attachImage('library')
    })
    await act(async () => {
      drafts!.setComposerText(CAPTION)
    })
  }

  for (const pasted of [false, true]) {
    const what = pasted ? 'a screenshot pasted off the clipboard' : 'a photo'
    it(`takes ${what} out of the composer as the box empties, and keeps it out once sent`, async () => {
      let open = (): void => {}
      const gate = new Promise<void>((resolve) => {
        open = resolve
      })
      mount(session('accepted', gate))
      await attach(pasted)
      expect(images!.attachments).toHaveLength(1)

      vi.useFakeTimers()
      let sending: Promise<boolean> | null = null
      await act(async () => {
        sending = images!.sendNativeChat(CAPTION)
        await vi.advanceTimersByTimeAsync(50)
      })
      expect(drafts!.composerText).toBe('')
      expect(drafts!.pending).toHaveLength(1)
      expect(images!.attachments).toEqual([])

      open()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })
      expect(await sending!).toBe(true)
      expect(images!.attachments).toEqual([])
      expect(drafts!.composerText).toBe('')
      expect(errors).toEqual([])
    })

    it(`puts ${what} and the words back when the session refuses the send`, async () => {
      mount(session('rejected', Promise.resolve()))
      await attach(pasted)

      vi.useFakeTimers()
      let sending: Promise<boolean> | null = null
      await act(async () => {
        sending = images!.sendNativeChat(CAPTION)
        await vi.advanceTimersByTimeAsync(1_000)
      })
      expect(await sending!).toBe(false)
      expect(images!.attachments).toHaveLength(1)
      expect(drafts!.composerText).toBe(CAPTION)
      expect(drafts!.pending).toEqual([])
    })
  }
})

