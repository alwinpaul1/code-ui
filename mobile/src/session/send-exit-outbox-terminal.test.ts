// Reported 2026-10-10 from the phone (Samsung S23 Ultra): "When I send a message from the input
// it leaves the input and takes time to land. Sometimes if I send and then immediately close the
// app or exit the app, the message isn't sent and not even in the input."
//
// The composer empties at the tap; until then the words lived only in the send's closure and the
// screen's state. A process killed with the send out (a swipe from Recents, Android reclaiming the
// app) took them with it, and an ack lost while the app was away was held as unconfirmed with the
// words gone from the box. The user's call (2026-10-10): "Message must be sent anyway". So each send
// is written to a durable outbox before the box empties, and the chat that next shows its tab sends
// it once more when that is safe, or hands it back.
//
// These drive the REAL draft store, the REAL message send, the REAL image hook and the REAL outbox
// recovery together against a desktop Claude Code tab. Screens CAPTURED with `tmux capture-pane -p`
// against Claude Code 2.1.296 at 46 columns (2026-10-09), shared with
// use-mobile-native-chat-send-paused.test.ts. A process restart is modelled as Android has it: the
// tree is torn down, every module's memory is reset, and only the storage survives.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'
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
import { useMobileNativeChatOutbox } from './use-mobile-native-chat-outbox'
import { nativeChatOutboxEntries, resetNativeChatOutboxForTests } from '../storage/native-chat-outbox'
import { resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { resetNativeChatSendTimingForTests } from './native-chat-send-timing'
import { OUTBOX_ECHO_PREFIX } from './mobile-native-chat-outbox-drafts'

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
  '  Haiku 5.5 medium │ ◔ — ',
  '  ◷ 5h 4% │ Sat 3:20 AM  ',
  '  ▦ 7d 45% │ Wed 7:00 PM '
]
const FOOTER = '  ⏵⏵ auto mode on (shift+tab to cycle)'
const holding = (text: string): string[] => [...STATUS, RULE, `❯ ${text}`, RULE, FOOTER]
const submitted = (text: string): string[] => [
  `❯ ${text}`,
  '✽ Sock-hopping… (1s · thinking)',
  ...STATUS,
  RULE,
  '❯ ',
  RULE,
  `${FOOTER} · ← …`
]

const TEXT = 'is everything fixed and done'

type BodyEnd = 'accepted' | 'hang' | 'lost'
type Desktop = { client: RpcClient; submittedBodies: string[]; body: BodyEnd }

/**
 * A desktop Claude tab. `body` says how the submitting write ends:
 * - `accepted`: submitted and answered.
 * - `hang`: never answered and never submitted (the process dies with it on the wire; a
 *   process that lives on sees the client's own timer give up on it).
 * - `lost`: the link drops with the frame written, and it never reached the agent.
 */
function desktop(body: BodyEnd = 'accepted'): Desktop {
  let input = ''
  let uploads = 0
  const state: Desktop = { client: null as unknown as RpcClient, submittedBodies: [], body }
  state.client = {
    getState: () => 'connected',
    notifyForeground: vi.fn(),
    getLastConnectedAt: () => 1,
    sendRequest: vi.fn(async (method: string, params: { text?: string; enter?: boolean }, options?: { timeoutMs?: number }) => {
      if (method !== 'terminal.read' && method !== 'terminal.send') {
        uploads += 1
        return uploads % 2 === 1 ? methodNotFound('start') : ok('save', `/tmp/orca-paste-${uploads}.png`)
      }
      if (method === 'terminal.read') {
        const last = state.submittedBodies.at(-1)
        return ok('r', { terminal: { source: 'screen', tail: last === undefined ? holding(input) : submitted(last), draft: '' } })
      }
      if (params.enter === true) {
        if (state.body === 'hang') {
          // No answer: the client's own timer gives up on it, as a real one does.
          return new Promise((_resolve, reject) =>
            setTimeout(() => reject(markRpcDeliveryUnknown(new Error('relay RPC timed out'))), options?.timeoutMs ?? 15_000)
          )
        }
        if (state.body === 'lost') {
          throw markRpcDeliveryUnknown(new Error('relay RPC timed out: terminal.send'))
        }
        input = ''
        state.submittedBodies.push(params.text ?? '')
        return ok('s', { send: { accepted: true } })
      }
      input = ''
      return ok('s', { send: { accepted: true } })
    })
  } as unknown as RpcClient
  return state
}

function userRow(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}

describe('a chat message the app was closed under', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
  let images: ReturnType<typeof useMobileNativeChatImageAttachments> | null = null
  let outbox: ReturnType<typeof useMobileNativeChatOutbox> | null = null
  let messages: NativeChatMessage[] = []
  /** The screen's word on the agent: a card or dialog up, or working. */
  let promptUp = false
  let Screen: (() => null) | null = null
  const errors: string[] = []

  beforeEach(() => {
    errors.length = 0
    messages = []
    promptUp = false
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
    resetLiveNativeChatDraftsForTests()
    resetAppForegroundClockForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    await clearNativeChatDraftStores()
  })

  /** One chat screen; `recover` mounts the outbox recovery as the controller does. */
  function mount(client: RpcClient, recover = true): void {
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
      outbox = useMobileNativeChatOutbox({
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-a',
        sessionId: 'session-1',
        showNativeChat: recover,
        structured: false,
        terminalChat: true,
        messages,
        transcriptSettled: true,
        receipts: [],
        inputSendable: true,
        agentWorking: false,
        promptUp,
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

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  async function rerender(): Promise<void> {
    await act(async () => {
      renderer!.update(createElement(Screen!))
    })
  }

  /** Types `text` and taps Send; runs the clock `forMs` while the send is out; does not wait for it. */
  async function typeAndTap(text: string, forMs = 2_000): Promise<{ sending: Promise<boolean> }> {
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
    // Wrapped: an async function returning the bare promise would wait for the send.
    return { sending: sending! }
  }

  /** Android kills the process: the tree goes, every module forgets, storage stays. */
  async function processRestart(): Promise<void> {
    await act(async () => {
      renderer?.unmount()
      await vi.advanceTimersByTimeAsync(0)
    })
    renderer = null
    resetLiveNativeChatDraftsForTests()
    resetMobileNativeChatTerminalWritesForTests()
    resetMobileNativeChatStaleInputForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    resetNativeChatSendTimingForTests()
  }

  const outboxBubbles = (): string[] =>
    drafts!.pending.filter((item) => item.id.startsWith(OUTBOX_ECHO_PREFIX)).map((item) => item.text)

  it('sends it exactly once on the next start when the desktop never got it', async () => {
    mount(desktop('hang').client)
    await typeAndTap(TEXT)
    expect(drafts!.composerText).toBe('')

    await processRestart()
    const tab = desktop()
    mount(tab.client)
    // The bubble is back at once, saying it is on its way.
    await advance(100)
    expect(outboxBubbles()).toEqual([TEXT])
    expect(Object.values(outbox!.deliveries)).toEqual(['sending'])
    await advance(5_000)

    expect(tab.submittedBodies).toEqual([TEXT])
    expect(drafts!.composerText).toBe('')
    expect(errors).toEqual([])
    // Its row lands: the outbox is empty and nothing is ever sent again.
    messages = [userRow('u-1', TEXT)]
    await rerender()
    await advance(60_000)
    expect(tab.submittedBodies).toEqual([TEXT])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('draws the message as "Sending…" as the box empties, not after the whole send', async () => {
    mount(desktop('hang').client)
    await typeAndTap(TEXT, 300)

    expect(drafts!.composerText).toBe('')
    expect(outboxBubbles()).toEqual([TEXT])
    expect(Object.values(outbox!.deliveries)).toEqual(['sending'])
  })

  it('takes the "Sending…" bubble down and puts the words back when the desktop refuses', async () => {
    const tab = desktop()
    mount(tab.client)
    tab.client.sendRequest = vi.fn(async (method: string, params: { enter?: boolean }) =>
      method === 'terminal.read'
        ? ok('r', { terminal: { source: 'screen', tail: holding(''), draft: '' } })
        : ok('s', { send: { accepted: params.enter !== true } })
    ) as never
    const { sending } = await typeAndTap(TEXT)

    expect(await sending).toBe(false)
    expect(drafts!.composerText).toBe(TEXT)
    expect(outboxBubbles()).toEqual([])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('sends nothing and says nothing when the transcript shows it landed before the restart', async () => {
    mount(desktop('hang').client)
    await typeAndTap(TEXT)

    await processRestart()
    messages = [userRow('u-1', TEXT)]
    const tab = desktop()
    mount(tab.client)
    await advance(10_000)

    expect(tab.submittedBodies).toEqual([])
    expect(drafts!.composerText).toBe('')
    expect(errors).toEqual([])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('waits while a permission prompt is open and sends once the agent is idle', async () => {
    mount(desktop('hang').client)
    await typeAndTap(TEXT)

    await processRestart()
    promptUp = true
    const tab = desktop()
    mount(tab.client)
    await advance(60_000)
    expect(tab.submittedBodies).toEqual([])
    expect(outboxBubbles()).toEqual([TEXT])

    promptUp = false
    await rerender()
    await advance(1_000)
    // Not at the first idle moment: a queued message the agent takes as its turn ends would
    // draw its row then.
    expect(tab.submittedBodies).toEqual([])
    await advance(4_000)
    expect(tab.submittedBodies).toEqual([TEXT])
    expect(errors).toEqual([])
  })

  it('puts a message more than a day old back after the newer words in the box, and sends nothing', async () => {
    mount(desktop('hang').client)
    await typeAndTap(TEXT)

    await processRestart()
    // The user typed something new before the app went; it is still on disk.
    await AsyncStorage.setItem(`orca:chatDraft:${encodeURIComponent('h\0w\0tab-a')}`, 'newer words')
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000)
    const tab = desktop()
    mount(tab.client)
    await advance(5_000)

    expect(tab.submittedBodies).toEqual([])
    expect(drafts!.composerText).toBe(`newer words\n\n${TEXT}`)
    expect(outboxBubbles()).toEqual([])
    expect(errors).toEqual([
      'Message not sent: the app closed before it reached your desktop, more than a day ago. Send it again'
    ])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('never types it twice when the process dies again during the resend', async () => {
    mount(desktop('hang').client)
    await typeAndTap(TEXT)
    await processRestart()
    // The resend goes out and the process dies before the desktop answers.
    mount(desktop('hang').client)
    await advance(5_000)
    expect(nativeChatOutboxEntries().map((entry) => entry.autoAttempts)).toEqual([1])

    await processRestart()
    const tab = desktop()
    mount(tab.client)
    await advance(60_000)

    // A copy may already be out and a terminal has no id to dedupe on: it waits for the user.
    expect(tab.submittedBodies).toEqual([])
    expect(outboxBubbles()).toEqual([TEXT])
    expect(Object.values(outbox!.deliveries)).toEqual(['failed'])
    expect(drafts!.composerText).toBe('')

    // Retry sends it, once.
    await act(async () => {
      outbox!.retry(Object.keys(outbox!.deliveries)[0]!)
    })
    await advance(5_000)
    expect(tab.submittedBodies).toEqual([TEXT])
  })

  it('Edit puts the words of a message that could not be sent back in the box and drops its bubble', async () => {
    mount(desktop('hang').client)
    await typeAndTap(TEXT)
    await processRestart()
    mount(desktop('hang').client)
    await advance(5_000)
    await processRestart()
    mount(desktop().client)
    await advance(5_000)
    expect(Object.values(outbox!.deliveries)).toEqual(['failed'])

    await act(async () => {
      outbox!.edit(Object.keys(outbox!.deliveries)[0]!)
    })
    await advance(100)

    expect(drafts!.composerText).toBe(TEXT)
    expect(outboxBubbles()).toEqual([])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('still sends today, with the words back on a refusal, when the outbox cannot be written', async () => {
    const setItem = vi.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key: string) => {
      if (key === 'orca:chatOutbox') {
        throw new Error('disk full')
      }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const tab = desktop()
      mount(tab.client)
      expect(await (await typeAndTap(TEXT)).sending).toBe(true)
      expect(tab.submittedBodies).toEqual([TEXT])
      expect(drafts!.composerText).toBe('')
      expect(errors).toEqual([])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not save the chat outbox'), expect.anything())
    } finally {
      setItem.mockRestore()
      warn.mockRestore()
    }
  })

  describe('an acknowledgement lost while the app was in the background (no service running)', () => {
    it('sends it once more when nothing shows it arrived, instead of losing the words', async () => {
      // The body goes out, the app leaves, the link drops with the frame on the wire and the
      // agent never gets it. Back a minute later, the RPC's failure reads as "unknown".
      const tab = desktop('lost')
      mount(tab.client)
      noteAppForeground(false)
      await typeAndTap(TEXT, 1_000)
      vi.setSystemTime(Date.now() + 60_000)
      noteAppForeground(true)
      // Held for its row: no notice yet, the box empty.
      expect(errors).toEqual([])
      expect(drafts!.composerText).toBe('')
      // The link comes back to a desktop that answers; the hold's time runs out with no row.
      tab.body = 'accepted'
      await advance(25_000)

      expect(tab.submittedBodies).toEqual([TEXT])
      expect(errors).toEqual([])
      expect(outboxBubbles()).toEqual([TEXT])
      // Its row lands and nothing more goes.
      messages = [userRow('u-1', TEXT)]
      await rerender()
      await advance(60_000)
      expect(tab.submittedBodies).toEqual([TEXT])
      expect(nativeChatOutboxEntries()).toEqual([])
    })

    it('sends nothing more when the row shows it did arrive', async () => {
      const tab = desktop('lost')
      mount(tab.client)
      await typeAndTap(TEXT, 1_000)
      tab.body = 'accepted'
      messages = [userRow('u-1', TEXT)]
      await rerender()
      await advance(60_000)

      expect(tab.submittedBodies).toEqual([])
      expect(errors).toEqual([])
      expect(nativeChatOutboxEntries()).toEqual([])
    })
  })

  it('completes a send the app left while the background service kept its timers running', async () => {
    // The service's headless task keeps React Native's timers alive with no Activity resumed
    // (docs/mobile-background-delivery.md): the app is away, the clock and the timers both run.
    const tab = desktop()
    mount(tab.client)
    noteAppForeground(false)
    const { sending } = await typeAndTap(TEXT, 10_000)
    noteAppForeground(true)

    expect(await sending).toBe(true)
    expect(tab.submittedBodies).toEqual([TEXT])
    expect(errors).toEqual([])
    expect(drafts!.composerText).toBe('')
  })
})
