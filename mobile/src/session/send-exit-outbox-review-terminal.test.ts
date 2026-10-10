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
import { resetAppForegroundClockForTests } from './app-foreground-clock'
import { baseArgs, methodNotFound, ok } from './use-mobile-native-chat-image-attachments.test-support'
import { useMobileNativeChatOutbox } from './use-mobile-native-chat-outbox'
import { nativeChatOutboxEntries, resetNativeChatOutboxForTests } from '../storage/native-chat-outbox'
import { isOutboxSendLive, resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { resetNativeChatSendTimingForTests } from './native-chat-send-timing'
import { OUTBOX_ECHO_PREFIX } from './mobile-native-chat-outbox-drafts'
import { classifyMobileNativeChatSend } from './mobile-native-chat-send-classification'

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

type BodyEnd = 'accepted' | 'hang' | 'lost' | 'deliveredHang'
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
        if (state.body === 'deliveredHang') {
          // The agent got it (submitted), but the answer never comes back.
          input = ''
          state.submittedBodies.push(params.text ?? '')
          return new Promise(() => {})
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

describe('outbox regressions found in review (2026-10-10) (terminal)', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
  let images: ReturnType<typeof useMobileNativeChatImageAttachments> | null = null
  let outbox: ReturnType<typeof useMobileNativeChatOutbox> | null = null
  let messages: NativeChatMessage[] = []
  /** The screen's word on the agent: a card or dialog up, or working. */
  let promptUp = false
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
    act(() => {
      renderer = create(createElement(ChatScreen))
    })
  }

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
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

  it('control: a chat message the desktop got before the process died is not typed again', async () => {
    const first = desktop('deliveredHang')
    mount(first.client)
    await typeAndTap(TEXT)
    expect(first.submittedBodies).toEqual([TEXT])
    await processRestart()
    messages = [userRow('u-1', TEXT)]
    const tab = desktop()
    mount(tab.client)
    await advance(30_000)
    expect(tab.submittedBodies).toEqual([])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('does not run a slash command a second time after the process died with it out', async () => {
    const COMMAND = '/compact'
    expect(classifyMobileNativeChatSend('claude', COMMAND)).not.toBe('chat')
    const first = desktop('deliveredHang')
    mount(first.client)
    await typeAndTap(COMMAND)
    // The desktop ran it; the process dies before the answer.
    expect(first.submittedBodies).toEqual([COMMAND])
    await processRestart()
    const tab = desktop()
    mount(tab.client)
    for (let i = 0; i < 12; i += 1) {
      await advance(10_000)
    }
    // A command writes no transcript row, so nothing can ever show it landed: a blind resend
    // runs it twice.
    expect(tab.submittedBodies).toEqual([])
  })

  it('leaves no early bubble for a recovered slash command, which never gets a row', async () => {
    const COMMAND = '/compact'
    mount(desktop('hang').client)
    await typeAndTap(COMMAND)
    // No early bubble for a command on the live send.
    expect(outboxBubbles()).toEqual([])
    await processRestart()
    const tab = desktop()
    mount(tab.client)
    const seen: string[][] = []
    for (let i = 0; i < 12; i += 1) {
      await advance(10_000)
      seen.push(outboxBubbles())
    }
    expect({ sent: tab.submittedBodies, seen: seen.filter((b) => b.length > 0).length, last: outboxBubbles(), pending: drafts!.pending.map((p) => p.text) }).toEqual({ sent: [], seen: 0, last: [], pending: [] })
  })

  it('sees a send through when its chat closed before the acknowledgement was lost (same process)', async () => {
    mount(desktop('hang').client)
    await typeAndTap(TEXT, 300)
    expect(drafts!.composerText).toBe('')
    // The user leaves the chat with the send out; the process lives on.
    await act(async () => {
      renderer!.unmount()
      await vi.advanceTimersByTimeAsync(0)
    })
    renderer = null
    // The send's own timer gives up: "unknown", with no chat mounted to hold it.
    await advance(40_000)
    // Back to the tab, same process, with a desktop that answers.
    const tab = desktop()
    mount(tab.client)
    for (let i = 0; i < 12; i += 1) {
      await advance(10_000)
    }
    const resolved =
      tab.submittedBodies.includes(TEXT) || drafts!.composerText.includes(TEXT) || errors.length > 0
    expect({ resolved, live: nativeChatOutboxEntries().map((entry) => isOutboxSendLive(entry.id)), entries: nativeChatOutboxEntries().length, deliveries: Object.values(outbox!.deliveries) }).toEqual({
      resolved: true,
      live: [],
      entries: 0,
      deliveries: []
    })
  })

  it('Edit right after another send puts back only the failed words, not the message just sent', async () => {
    mount(desktop('hang').client)
    await typeAndTap(TEXT)
    await processRestart()
    mount(desktop('hang').client)
    await advance(5_000)
    await processRestart()
    const tab = desktop()
    mount(tab.client)
    await advance(5_000)
    expect(Object.values(outbox!.deliveries)).toEqual(['failed'])
    const failedRow = Object.keys(outbox!.deliveries)[0]!

    // A new message, sent; the user taps Edit on the old bubble at once.
    await typeAndTap('other words', 100)
    await act(async () => {
      outbox!.edit(failedRow)
    })
    await advance(100)
    expect(tab.submittedBodies).toContain('other words')
    expect(drafts!.composerText).toBe(TEXT)
  })
})
