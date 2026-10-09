// Reported 2026-10-09 from the phone (Code UI 0.9.118, a Claude Code terminal chat on a
// macOS host): "when I press the arrow to send something it shows the send and then after
// some time when I go again it shows like message not send".
//
// What happens: React Native on Android runs no JS timer while the app is out of the
// foreground (unless a headless task is active), and Android may freeze the process, but the
// wall clock keeps going. A send keeps its budget, its check of the screen and its wait for an
// echo on the wall clock. The composer empties BEFORE the body goes out, and between the
// emptied box and the body there is a timer (the clear's 150 ms settle,
// mobile-native-chat-verified-clear.ts). A send the user left there came back with its whole
// budget spent, wrote nothing more, and said a bare "Message not sent" with the words back in
// the box. A send left during its check after the Enter came back to a window already over,
// took no look at the screen that showed its echo, and held a delivered message as
// unconfirmed. A send held unconfirmed before the user left had its 20 s deadline fire on the
// way back, before the transcript could reconnect, and said "Delivery unconfirmed".
//
// These drive the REAL draft store, the REAL message send and the REAL image hook together.
// Screens CAPTURED with `tmux capture-pane -p` against Claude Code 2.1.296 at 46 columns
// (2026-10-09; Haiku 5.5, the user's own status line), blank rows dropped as Orca's screen
// read drops them. A pause is modelled as React Native has it: the app leaves the foreground
// (the AppState clock is told), the wall clock jumps, the app comes back, and only then do the
// timers that came due run.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { resetLiveNativeChatDraftsForTests } from './mobile-native-chat-live-drafts'
import { noteAppForeground, resetAppForegroundClockForTests } from './app-foreground-clock'
import { baseArgs, methodNotFound, ok } from './use-mobile-native-chat-image-attachments.test-support'

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

// ─── Claude Code 2.1.296, 46 columns, captured 2026-10-09 ────────────────────
const RULE = '─'.repeat(46)
const STATUS = [
  '                                          [-]',
  '  Haiku 5.5 medium │ ◔ — ',
  '  ◷ 5h 4% │ Sat 3:20 AM  ',
  '  ▦ 7d 45% │ Wed 7:00 PM '
]
const FOOTER = '  ⏵⏵ auto mode on (shift+tab to cycle)'
/** The input holding text: `❯`, a NO-BREAK SPACE, the text. */
const holding = (text: string): string[] => [...STATUS, RULE, `❯ ${text}`, RULE, FOOTER]
/** Just after the Enter: the prompt drawn above, the spinner, an empty input. */
const submitted = (text: string): string[] => [
  `❯ ${text}`,
  '✽ Sock-hopping… (1s · thinking)',
  ...STATUS,
  RULE,
  '❯ ',
  RULE,
  `${FOOTER} · ← …`
]

const TEXT = 'is everything fixed and done'
const AWAY_MS = 60_000
const BACKGROUND =
  'Message not sent: the app was in the background before it reached your desktop. Send it again'
const UNCONFIRMED = 'Delivery unconfirmed — check chat before retrying'

/** The app leaves the foreground, `ms` pass on the wall clock with no timer run, and it comes back. */
function awayFor(ms: number): void {
  noteAppForeground(false)
  vi.setSystemTime(Date.now() + ms)
  noteAppForeground(true)
}

type Step = 'look' | 'clear' | 'body'
type Desktop = {
  client: RpcClient
  /** Bodies submitted with their Enter, in order. */
  submittedBodies: string[]
  /** Clear writes received. */
  clears: number
}

/** A desktop Claude (or Codex) tab. `on` runs as each request arrives, after it is answered. */
function desktop(options: {
  on?: (step: Step, nth: number) => void
  /** The first look after the Enter still finds the words in the input: Claude has not read them yet. */
  paintsLate?: boolean
  /** How the body's write ends. */
  body?: 'accepted' | 'refused' | 'ack-lost'
  /** The clear's answer takes this long. */
  clearTakesMs?: number
}): Desktop {
  let input = ''
  let uploads = 0
  let latePaintPending = false
  const seen: Record<Step, number> = { look: 0, clear: 0, body: 0 }
  const state: Desktop = { client: null as unknown as RpcClient, submittedBodies: [], clears: 0 }
  const answered = <T,>(step: Step, value: T): T => {
    seen[step] += 1
    options.on?.(step, seen[step])
    return value
  }
  state.client = {
    getState: () => 'connected',
    notifyForeground: vi.fn(),
    getLastConnectedAt: () => 1,
    sendRequest: vi.fn(async (method: string, params: { text?: string; enter?: boolean }) => {
      if (method !== 'terminal.read' && method !== 'terminal.send') {
        // A photo's upload: a streamed start this host does not have, then the whole file.
        uploads += 1
        return uploads % 2 === 1 ? methodNotFound('start') : ok('save', `/tmp/orca-paste-${uploads}.png`)
      }
      if (method === 'terminal.read') {
        const body = state.submittedBodies.at(-1)
        const tail =
          body === undefined || latePaintPending ? holding(latePaintPending ? body! : input) : submitted(body)
        latePaintPending = false
        return answered('look', ok('r', { terminal: { source: 'screen', tail, draft: '' } }))
      }
      if (params.enter === true) {
        if (options.body === 'refused') {
          return answered('body', ok('s', { send: { accepted: false } }))
        }
        input = ''
        state.submittedBodies.push(params.text ?? '')
        latePaintPending = options.paintsLate === true
        if (options.body === 'ack-lost') {
          answered('body', null)
          throw markRpcDeliveryUnknown(new Error('relay RPC timed out: terminal.send'))
        }
        return answered('body', ok('s', { send: { accepted: true } }))
      }
      if (options.clearTakesMs) {
        await new Promise((resolve) => setTimeout(resolve, options.clearTakesMs))
      }
      input = ''
      state.clears += 1
      return answered('clear', ok('s', { send: { accepted: true } }))
    })
  } as unknown as RpcClient
  return state
}

function userRow(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}

describe('a chat send while the app leaves the foreground', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
  let images: ReturnType<typeof useMobileNativeChatImageAttachments> | null = null
  let messages: NativeChatMessage[] = []
  let Screen: (() => null) | null = null
  const errors: string[] = []

  beforeEach(() => {
    errors.length = 0
    messages = []
    resetAppForegroundClockForTests()
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
    useNativeChatImageAttachmentsStore.getState().reset()
  })
  afterEach(async () => {
    vi.useRealTimers()
    act(() => renderer?.unmount())
    renderer = null
    drafts = null
    images = null
    resetLiveNativeChatDraftsForTests()
    resetAppForegroundClockForTests()
    await clearNativeChatDraftStores()
  })

  function mount(client: RpcClient, agent: 'claude' | 'codex' = 'claude'): void {
    function ChatScreen(): null {
      drafts = useMobileNativeChatDrafts({
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-a',
        sessionId: 'session-1',
        messages,
        transcriptSettled: true
      })
      const send = useMobileNativeChatMessageSend({
        client,
        enabled: true,
        handleRef: { current: 'term-1' },
        deviceTokenRef: { current: null },
        agentRef: { current: agent },
        commandSendRef: { current: vi.fn() },
        captureSendOrigin: drafts.captureSendOrigin,
        readSeededLaunchDraftSeed: () => null,
        clearDraftForSend: drafts.clearDraftForSend,
        restoreRejectedDraft: drafts.restoreRejectedDraft,
        acceptSend: drafts.acceptSend,
        holdUnconfirmedSend: drafts.holdUnconfirmedSend,
        onSendError: (message) => errors.push(message)
      })
      images = useMobileNativeChatImageAttachments(
        baseArgs({
          client,
          agent,
          hostTerminalOfTab: () => 'term-1',
          beginImageSend: drafts.clearDraftAtSendStart,
          onSendError: (message) => errors.push(message),
          baseSend: (text, previews, deadline, _attachments, follow) =>
            send.sendWithOutcome(text, previews, deadline, follow)
        })
      )
      return null
    }
    Screen = ChatScreen
    act(() => {
      renderer = create(createElement(ChatScreen))
    })
  }

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  /** Types `text`, taps Send, and runs the clock `forMs` in small steps while the send is out. */
  async function typeAndSend(text: string, forMs = 30_000): Promise<boolean> {
    await act(async () => {
      drafts!.setComposerText(text)
    })
    vi.useFakeTimers()
    await advance(300)
    let sending: Promise<boolean> | null = null
    await act(async () => {
      sending = images!.sendNativeChat(text)
      await vi.advanceTimersByTimeAsync(0)
    })
    for (let ran = 0; ran < forMs; ran += 100) {
      await advance(100)
    }
    return sending!
  }

  describe('left between the emptied box and the body', () => {
    for (const agent of ['claude', 'codex'] as const) {
      it(`says the app was in the background, with the words back in the box (${agent})`, async () => {
        // Claude: the app leaves while the clear's settle is out. Codex has no settle: the
        // process is frozen while its clear is on the wire.
        const tab = desktop({ on: (step) => step === 'clear' && awayFor(AWAY_MS) })
        mount(tab.client, agent)

        expect(await typeAndSend(TEXT)).toBe(false)

        expect(tab.clears).toBe(1)
        expect(tab.submittedBodies).toEqual([])
        expect(drafts!.composerText).toBe(TEXT)
        expect(drafts!.pending).toEqual([])
        expect(errors).toEqual([BACKGROUND])
      })
    }

    it('says the app was in the background for a photo send left while its paste was going out', async () => {
      // The box, the chips and the bubble leave at once (clearDraftAtSendStartWith); the
      // process is frozen while the paste's leading clear is on the wire.
      const tab = desktop({ on: (step, nth) => step === 'clear' && nth === 1 && awayFor(AWAY_MS) })
      mount(tab.client)
      pick.mockResolvedValueOnce([{ base64: 'AAAA', uri: 'file:///phone/screen.jpg' }])
      await act(async () => {
        await images!.attachImage('library')
      })
      expect(images!.attachments).toHaveLength(1)

      expect(await typeAndSend(TEXT)).toBe(false)

      expect(tab.submittedBodies).toEqual([])
      expect(drafts!.composerText).toBe(TEXT)
      expect(images!.attachments).toHaveLength(1)
      expect(drafts!.pending).toEqual([])
      expect(errors).toEqual([BACKGROUND])
    })

    it('says the desktop did not answer when the budget ran out with the app in the foreground', async () => {
      const tab = desktop({ clearTakesMs: 13_500 })
      mount(tab.client)

      expect(await typeAndSend(TEXT)).toBe(false)

      expect(tab.submittedBodies).toEqual([])
      expect(drafts!.composerText).toBe(TEXT)
      expect(errors).toEqual(['Message not sent: your desktop did not answer within 15 s. Send it again'])
    })

    it('still says a bare "Message not sent" when the desktop refused the body with budget left', async () => {
      // A short time away earlier in the send is not the reason: the desktop answered "no".
      const tab = desktop({ body: 'refused', on: (step) => step === 'clear' && awayFor(1_000) })
      mount(tab.client)

      expect(await typeAndSend(TEXT)).toBe(false)

      expect(drafts!.composerText).toBe(TEXT)
      expect(errors).toEqual(['Message not sent'])
    })
  })

  describe('left while it checks that Claude took the words', () => {
    it('looks again on the way back and shows the sent message, not "Delivery unconfirmed"', async () => {
      // The first look after the Enter finds the words still in the input; the app leaves
      // before the next. Back a minute later, the screen draws the prompt above the composer.
      const tab = desktop({
        paintsLate: true,
        on: (step, nth) => step === 'look' && nth === 3 && awayFor(AWAY_MS)
      })
      mount(tab.client)

      expect(await typeAndSend(TEXT)).toBe(true)

      expect(tab.submittedBodies).toEqual([TEXT])
      expect(drafts!.composerText).toBe('')
      expect(drafts!.pending.map((item) => item.text)).toEqual([TEXT])
      expect(errors).toEqual([])
    })

    it('does not call it sent when the look on the way back cannot be had', async () => {
      const tab = desktop({
        paintsLate: true,
        on: (step, nth) => {
          if (step === 'look' && nth === 3) {
            awayFor(AWAY_MS)
            // Every look from here fails: the link has not come back.
            tab.client.sendRequest = vi.fn(async () => {
              throw new Error('relay RPC timed out: terminal.read')
            }) as never
          }
        }
      })
      mount(tab.client)

      expect(await typeAndSend(TEXT, 5_000)).toBe(true)

      // Held for the transcript (no bubble yet), not drawn as sent and not refused.
      expect(drafts!.pending).toEqual([])
      expect(drafts!.composerText).toBe('')
      expect(errors).toEqual([])
    })
  })

  describe('held as unconfirmed when the app leaves', () => {
    /** A send whose ack was lost, held; resolves once the hold is parked. */
    async function heldSend(): Promise<Desktop> {
      const tab = desktop({ body: 'ack-lost' })
      mount(tab.client)
      expect(await typeAndSend(TEXT, 1_000)).toBe(true)
      expect(tab.submittedBodies).toEqual([TEXT])
      expect(errors).toEqual([])
      return tab
    }

    async function transcriptLands(): Promise<void> {
      messages = [userRow('u-1', TEXT)]
      await act(async () => {
        renderer!.update(createElement(Screen!))
      })
    }

    it('gives the transcript its time after the app is back, so a delivered message is not "unconfirmed"', async () => {
      await heldSend()
      // The deadline comes due while the app is away (no timer runs), then the app comes back
      // and the overdue timer fires at once.
      await advance(18_900)
      awayFor(AWAY_MS)
      await advance(500)
      expect(errors).toEqual([])
      // The link comes back and the transcript shows the message.
      await advance(5_000)
      await transcriptLands()
      await advance(30_000)

      expect(errors).toEqual([])
    })

    it('still says "Delivery unconfirmed" when nothing shows the message within its time after the app is back', async () => {
      await heldSend()
      await advance(18_900)
      awayFor(AWAY_MS)
      await advance(500)
      await advance(18_500)
      expect(errors).toEqual([])
      await advance(1_500)

      expect(errors).toEqual([UNCONFIRMED])
    })

    it('says nothing while the app is still away when the deadline fires there (a headless task runs timers)', async () => {
      await heldSend()
      noteAppForeground(false)
      await advance(60_000)
      expect(errors).toEqual([])
      noteAppForeground(true)
      await advance(19_000)
      expect(errors).toEqual([])
      await advance(1_500)

      expect(errors).toEqual([UNCONFIRMED])
    })

    it('says "Delivery unconfirmed" on time when the app never left', async () => {
      await heldSend()
      await advance(18_000)
      expect(errors).toEqual([])
      await advance(1_500)

      expect(errors).toEqual([UNCONFIRMED])
    })
  })
})
