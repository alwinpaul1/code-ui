// Reported 2026-10-11, on 0.9.128: "A text message that times out while you're in another chat is
// sent once when you come back. All messages must be send reliability and must not drop".
//
// The terminal lane has no operation id: typing a message again is posting it again. So the
// app-wide drainer sends a terminal entry only on evidence that it did not arrive, read from the
// desktop with no chat on screen (native-chat-outbox-headless.ts): the tab list (the tab, its
// session, its hooks' prompts, whether the agent works), the session's transcript (the row, or
// for a photo a row naming its pasted path), and the screen (no dialog, Claude's own box, nothing
// typed at the desk, an empty queue box). It waits OUTBOX_TERMINAL_CONFIRM_WAIT_MS after a send
// before it looks, so a row that lands a moment late is never typed twice.
//
// Drives the REAL draft store, the REAL message send, the REAL outbox and the REAL drainer with
// its REAL desktop reads, against a fake desktop Claude Code tab. Screens CAPTURED with
// `tmux capture-pane -p` against Claude Code 2.1.296 at 46 columns (2026-10-09), shared with
// send-exit-outbox-terminal.test.ts.

import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { resetLiveNativeChatDraftsForTests } from './mobile-native-chat-live-drafts'
import { resetAppForegroundClockForTests } from './app-foreground-clock'
import { ok } from './use-mobile-native-chat-image-attachments.test-support'
import { useMobileNativeChatOutbox } from './use-mobile-native-chat-outbox'
import {
  nativeChatOutboxEntries,
  resetNativeChatOutboxForTests,
  type NativeChatOutboxEntry
} from '../storage/native-chat-outbox'
import { mountOutboxDrainer, publishOutboxChatIdle, registerOutboxRecovery, resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { resetNativeChatSendTimingForTests } from './native-chat-send-timing'
import { createOutboxDrainer, type OutboxDrainer } from './native-chat-outbox-drainer'
import { nativeChatOutboxDrainDeps } from './native-chat-outbox-drain-deps'
import { OUTBOX_DRAIN_TERMINAL_ATTEMPTS } from './native-chat-outbox-drain-plan'

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
const PASTED = '/tmp/orca-paste-7.png'

type Submit = 'accepted' | 'lost' | 'landed-ack-lost'

/** A desktop Claude Code tab, its tab list, its transcript and its screen. */
type Desktop = {
  client: RpcClient
  /** Each body Claude took, in order: what the agent got. */
  submitted: string[]
  /** How the next submitting write ends. */
  submit: Submit
  transcript: NativeChatMessage[]
  agentState: 'working' | 'done'
  /** Text typed at the desk's own keyboard. */
  deskDraft: string
  tabPresent: boolean
  /** Someone starts typing at the desk once the screen has been read this many times. */
  deskTypingAtRead: number | null
  /** The input line holds more than the clear can reach: clears leave it as it was. */
  stuckInput: boolean
  reads: number
  hookPrompt: { prompt: string; at: number } | null
}

function userRow(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}

function desktop(submit: Submit = 'accepted'): Desktop {
  let input = ''
  const tab: Desktop = {
    client: null as unknown as RpcClient,
    submitted: [],
    submit,
    transcript: [userRow('u-0', 'earlier'), { id: 'a-0', role: 'assistant', blocks: [{ type: 'text', text: 'ok' }], timestamp: null, source: 'transcript' }],
    agentState: 'done',
    deskDraft: '',
    tabPresent: true,
    deskTypingAtRead: null,
    stuckInput: false,
    reads: 0,
    hookPrompt: null
  }
  // What Claude does with a prompt it takes: its UserPromptSubmit hook puts it on the tab status,
  // and with the agent idle it writes the prompt's row at once (a prompt taken mid-turn waits in
  // the queue). These are Claude's record of it, which a send counts as delivered on
  // (midturn-send-never-taken.test.ts); a tab that left neither would read as lost.
  const take = (text: string): void => {
    tab.submitted.push(text)
    input = ''
    tab.hookPrompt = { prompt: text.trim(), at: Date.now() }
    if (tab.agentState === 'done' && tab.submit !== 'landed-ack-lost') {
      tab.transcript = [...tab.transcript, userRow(`u-taken-${tab.submitted.length}`, text.trim())]
    }
  }
  tab.client = {
    getState: () => 'connected',
    notifyForeground: vi.fn(),
    getLastConnectedAt: () => 1,
    subscribe: vi.fn((method: string, _params: unknown, onData: (frame: unknown) => void) => {
      if (method === 'nativeChat.subscribe') {
        const rows = [...tab.transcript]
        setTimeout(() => onData({ type: 'snapshot', messages: rows, hasMore: false }), 10)
      }
      return () => {}
    }),
    sendRequest: vi.fn(async (method: string, params: { text?: string; enter?: boolean }) => {
      if (method === 'session.tabs.list') {
        return ok('t', {
          worktree: 'w',
          snapshotVersion: 1,
          activeTabId: 'tab-b',
          activeTabType: 'terminal',
          tabs: [
            ...(tab.tabPresent
              ? [
                  {
                    type: 'terminal',
                    id: 'tab-a',
                    title: 'claude',
                    terminal: 'term-1',
                    isActive: false,
                    agentStatus: {
                      state: tab.agentState,
                      prompt: tab.hookPrompt?.prompt ?? '',
                      updatedAt: tab.hookPrompt?.at ?? 1,
                      stateStartedAt: 1,
                      paneKey: 'tab-a:leaf',
                      agentType: 'claude',
                      stateHistory: [],
                      providerSession: { key: 'claude', id: 'session-1' }
                    }
                  }
                ]
              : []),
            { type: 'terminal', id: 'tab-b', title: 'other', terminal: 'term-2', isActive: true }
          ]
        })
      }
      if (method === 'terminal.read') {
        tab.reads += 1
        if (tab.deskTypingAtRead !== null && tab.reads >= tab.deskTypingAtRead) {
          tab.deskDraft = 'typed at the desk'
          tab.deskTypingAtRead = null
        }
        const last = tab.submitted.at(-1)
        const lines = last !== undefined && input === '' ? submitted(last) : holding(input || tab.deskDraft)
        return ok('r', { terminal: { source: 'screen', tail: lines, draft: input === '' ? tab.deskDraft : '' } })
      }
      if (method === 'terminal.send') {
        const text = params.text ?? ''
        const keys = [...text].every((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)
        if (!tab.stuckInput && (text.includes('\x15') || (keys && text.length > 0))) {
          // A clear: Ctrl+U, or Claude's backspace burst. It takes whatever the line holds.
          input = ''
          tab.deskDraft = ''
        }
        if (text.includes(PASTED)) {
          input = `${input}[Image #1] `
        }
        if (params.enter === true) {
          if (tab.submit === 'lost') {
            throw markRpcDeliveryUnknown(new Error('relay RPC timed out: terminal.send'))
          }
          take(text)
          if (tab.submit === 'landed-ack-lost') {
            // Claude took it and writes its row a few seconds later; the answer never came back.
            setTimeout(() => {
              tab.transcript = [...tab.transcript, userRow('u-sent', text)]
            }, 3_000)
            throw markRpcDeliveryUnknown(new Error('relay RPC timed out: terminal.send'))
          }
          return ok('s', { send: { accepted: true } })
        }
        const onlyKeys = [...text].every((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)
        if (!text.includes('\x15') && !text.includes(PASTED) && !onlyKeys) {
          input = `${input}${text}`
        }
        return ok('s', { send: { accepted: true } })
      }
      return ok('x', null)
    })
  } as unknown as RpcClient
  return tab
}

describe('a terminal chat message the phone could not confirm', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
  let send: ReturnType<typeof useMobileNativeChatMessageSend> | null = null
  let drainer: OutboxDrainer | null = null
  let unmountDrainer: (() => void) | null = null
  let tab: Desktop = desktop()
  const errors: string[] = []
  const logs: { level: string; message: string; detail: string }[] = []

  beforeEach(() => {
    errors.length = 0
    logs.length = 0
    tab = desktop()
    resetAppForegroundClockForTests()
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    resetNativeChatSendTimingForTests()
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

  /** The worktree screen with ANOTHER tab shown: tab-a's chat controller is mounted, its chat view is not. */
  function mountHidden(): void {
    mountController(false)
  }
  /** Tab-a's chat view on screen, its transcript settled. */
  function mountShown(): void {
    mountController(true)
  }
  function mountController(shown: boolean): void {
    function Controller(): null {
      drafts = useMobileNativeChatDrafts({
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-a',
        sessionId: 'session-1',
        messages: tab.transcript,
        transcriptSettled: true
      })
      send = useMobileNativeChatMessageSend({
        client: tab.client,
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
      useMobileNativeChatOutbox({
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-a',
        sessionId: 'session-1',
        showNativeChat: shown,
        structured: false,
        terminalChat: true,
        agent: 'claude',
        terminal: 'term-1',
        transcriptPath: null,
        messages: tab.transcript,
        transcriptSettled: true,
        receipts: [],
        inputSendable: true,
        agentWorking: false,
        promptUp: false,
        queuedCount: 0,
        composerText: drafts.composerText,
        setComposerText: drafts.setComposerText,
        sendTerminal: (text) => send!.sendWithOutcome(text),
        sendStructured: async () => 'rejected',
        showEcho: drafts.showOutboxEcho,
        removeEcho: drafts.removePending,
        onNotice: (message) => errors.push(message)
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Controller))
    })
  }

  function startDrainer(): void {
    unmountDrainer = mountOutboxDrainer()
    drainer = createOutboxDrainer({
      ...nativeChatOutboxDrainDeps,
      connectedClient: () => tab.client,
      log: (_hostId, line) => logs.push(line)
    })
    drainer.kick({ fresh: true })
  }

  async function advance(ms: number): Promise<void> {
    for (let ran = 0; ran < ms; ran += 250) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(Math.min(250, ms - ran))
      })
    }
  }

  async function press(text: string): Promise<void> {
    await act(async () => {
      drafts!.setComposerText(text)
    })
    await act(async () => {
      void send!.sendWithOutcome(text)
      await vi.advanceTimersByTimeAsync(0)
    })
  }

  function stored(overrides: Partial<NativeChatOutboxEntry>): NativeChatOutboxEntry {
    return {
      id: 'send-1',
      draftKey: 'h\0w\0tab-a',
      pendingKey: 'h\0w\0tab-a\0session-1',
      text: TEXT,
      normalizedText: TEXT,
      baselineOccurrences: 0,
      baselineTailMessageId: 'a-0',
      baselineResolved: true,
      createdAt: Date.now() - 60_000,
      operationId: 'op-1',
      autoAttempts: 0,
      route: {
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-a',
        lane: 'terminal',
        agent: 'claude',
        sessionId: 'session-1',
        terminal: 'term-1',
        transcriptPath: null
      },
      ...overrides
    }
  }

  it('types a text whose hold ran out while another chat was on screen, once, without its chat being opened', async () => {
    vi.useFakeTimers()
    tab.submit = 'lost'
    startDrainer()
    mountHidden()
    await press(TEXT)
    // The press's body goes out and its frame is lost on the way.
    await advance(3_000)
    expect(tab.submitted).toEqual([])
    expect(nativeChatOutboxEntries()).toHaveLength(1)
    tab.submit = 'accepted'
    // The hold runs out at 20 s; the drainer looks once the confirm wait from the press is over.
    await advance(45_000)

    expect(tab.submitted).toEqual([TEXT])
    expect(nativeChatOutboxEntries()).toEqual([])
    expect(errors).toEqual([])
    expect(logs.map((line) => line.message)).toEqual(['Message sent from the outbox'])
    await advance(120_000)
    expect(tab.submitted).toEqual([TEXT])
  })

  it('never types it again when Claude took it and its row lands a few seconds late', async () => {
    vi.useFakeTimers()
    tab.submit = 'landed-ack-lost'
    startDrainer()
    mountHidden()
    await press(TEXT)
    await advance(120_000)

    expect(tab.submitted).toEqual([TEXT])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('never types it again when its chat closes right after the send and the row lands a few seconds late', async () => {
    vi.useFakeTimers()
    tab.submit = 'landed-ack-lost'
    startDrainer()
    mountHidden()
    await press(TEXT)
    await advance(1_000)
    // The worktree screen goes (the user backs out): the held send is handed over at once.
    act(() => renderer?.unmount())
    renderer = null
    await advance(120_000)

    expect(tab.submitted).toEqual([TEXT])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('types nothing while the agent works, and types it once when the turn is over', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([stored({})]))
    tab.agentState = 'working'
    startDrainer()
    await advance(10 * 60_000)
    expect(tab.submitted).toEqual([])
    expect(nativeChatOutboxEntries()[0]!.failed).toBeUndefined()

    tab.agentState = 'done'
    await advance(90_000)
    expect(tab.submitted).toEqual([TEXT])
    // The send reads no prompt copy of its own here (the drainer's has none to read), so the entry
    // leaves on Claude's row, at the drainer's next look, never on the phone's own look at the screen.
    await advance(120_000)
    expect(tab.submitted).toEqual([TEXT])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('does not type over words someone is typing at the desk', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([stored({})]))
    tab.deskDraft = 'half a thought'
    startDrainer()
    await advance(5 * 60_000)
    expect(tab.submitted).toEqual([])

    tab.deskDraft = ''
    await advance(90_000)
    expect(tab.submitted).toEqual([TEXT])
  })

  it('takes the agent’s own prompt receipt as delivery and types nothing', async () => {
    vi.useFakeTimers()
    // The tab's last prompt was another one when the message left; now it is the message.
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([stored({ route: { ...stored({}).route!, promptBefore: 'earlier' } })]))
    tab.hookPrompt = { prompt: TEXT, at: Date.now() - 30_000 }
    startDrainer()
    await advance(60_000)
    expect(tab.submitted).toEqual([])
    expect(nativeChatOutboxEntries()).toEqual([])
    expect(logs.map((line) => line.message)).toEqual(['Message from the outbox had arrived'])
  })

  it('does not take the prompt the tab already had as its receipt, however fresh its stamp', async () => {
    vi.useFakeTimers()
    // "continue" twice: the second never reached the desk, and a reconnect restamped the status.
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([stored({ route: { ...stored({}).route!, promptBefore: TEXT } })]))
    tab.hookPrompt = { prompt: TEXT, at: Date.now() }
    startDrainer()
    await advance(60_000)
    expect(tab.submitted).toEqual([TEXT])
  })

  it('keeps the words, says nothing in a chat, and writes one line when its tab was closed', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([stored({})]))
    tab.tabPresent = false
    startDrainer()
    await advance(10 * 60_000)

    expect(tab.submitted).toEqual([])
    expect(nativeChatOutboxEntries()).toEqual([expect.objectContaining({ text: TEXT, failed: true, failedReason: 'tabClosed' })])
    expect(logs).toHaveLength(1)
  })

  it('types a terminal entry at most a few times when every try is lost', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([stored({})]))
    tab.submit = 'lost'
    startDrainer()
    await advance(60 * 60_000)
    // Each try was preceded by a look that found no row; then it stops and says "Not sent".
    expect(nativeChatOutboxEntries()).toEqual([
      expect.objectContaining({ failed: true, failedReason: 'attempts', autoAttempts: OUTBOX_DRAIN_TERMINAL_ATTEMPTS })
    ])
    expect(logs).toHaveLength(1)
  })

  // ─── Found by the Opus review of 4efae5746 ───────────────────────────────────

  it('clears and types again when the only words in the desk\u2019s input are its own, left by an earlier try', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([stored({ autoAttempts: 1, lastAttemptAt: Date.now() - 60_000 })]))
    tab.deskDraft = TEXT
    startDrainer()
    await advance(90_000)
    expect(tab.submitted).toEqual([TEXT])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('does not type when someone starts typing at the desk between the look and the send', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([stored({})]))
    // The look reads the screen once; the send's own looks come after it.
    tab.deskTypingAtRead = 2
    startDrainer()
    await advance(5 * 60_000)
    expect(tab.submitted).toEqual([])
    expect(tab.deskDraft).toBe('typed at the desk')
    expect(nativeChatOutboxEntries()[0]!.failed).toBeUndefined()
  })

  it('does not give up on a tab that is missing from one reading and back on the next', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([stored({})]))
    // Orca restarting on the desktop: the phone reconnects before the tabs are restored.
    tab.tabPresent = false
    startDrainer()
    await advance(20_000)
    tab.tabPresent = true
    await advance(120_000)
    expect(tab.submitted).toEqual([TEXT])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('writes one line for an entry it gives up on, even when the store will not save the mark', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([stored({})]))
    tab.tabPresent = false
    const setItem = vi.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('disk full'))
    try {
      startDrainer()
      await advance(30 * 60_000)
      expect(logs.filter((line) => line.level === 'warn')).toHaveLength(1)
    } finally {
      setItem.mockRestore()
    }
  })

  it('keeps an on-screen chat\u2019s later text behind its older photo', async () => {
    vi.useFakeTimers()
    const older = stored({
      id: 'photo',
      createdAt: Date.now() - 90_000,
      hasAttachments: true,
      attachments: [{ path: PASTED, previewUri: 'file:///p.jpg' }]
    })
    const later = stored({ id: 'text', operationId: 'op-2', text: 'and then this', normalizedText: 'and then this', createdAt: Date.now() - 30_000 })
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([older, later]))
    // The chat is on screen with no drainer running: the photo is the drainer's, so it waits.
    mountShown()
    await advance(60_000)
    expect(tab.submitted).toEqual([])
    expect(nativeChatOutboxEntries().map((entry) => entry.id)).toEqual(['photo', 'text'])
  })

    // Re-review of 978156bf9.
  it('gives back, rather than holds, a photo the drainer cannot send (no session yet)', async () => {
    vi.useFakeTimers()
    const older = stored({
      id: 'photo',
      createdAt: Date.now() - 90_000,
      hasAttachments: true,
      attachments: [{ path: PASTED, previewUri: 'file:///p.jpg' }],
      route: { ...stored({}).route!, sessionId: null }
    })
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([older]))
    mountShown()
    await advance(60_000)
    // The drainer could never send it, so it does not sit at "Sending…" holding the chat: its
    // words come back to the box (the photos to attach again), as from an older build.
    expect(nativeChatOutboxEntries()).toEqual([])
    expect(drafts!.composerText).toBe(TEXT)
  })

  describe('a photo send pending at an app restart', () => {
    const photo = (): NativeChatOutboxEntry =>
      stored({ hasAttachments: true, attachments: [{ path: PASTED, previewUri: 'file:///p.jpg' }] })

    it('is pasted and sent once when it never arrived', async () => {
      vi.useFakeTimers()
      await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([photo()]))
      startDrainer()
      await advance(30_000)

      expect(tab.submitted).toEqual([TEXT])
      expect(nativeChatOutboxEntries()).toEqual([])
      // Its row lands naming the path; a later start finds nothing to send.
      tab.transcript = [...tab.transcript, userRow('u-c', `[Image: source: ${PASTED}]`), userRow('u-p', `[Image #1] ${TEXT}`)]
      await advance(120_000)
      expect(tab.submitted).toEqual([TEXT])
    })

    it('is not sent again when its row naming the pasted path is already there', async () => {
      vi.useFakeTimers()
      tab.transcript = [...tab.transcript, userRow('u-c', `[Image: source: ${PASTED}]`), userRow('u-p', `[Image #1] ${TEXT}`)]
      await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([photo()]))
      startDrainer()
      await advance(120_000)

      expect(tab.submitted).toEqual([])
      expect(nativeChatOutboxEntries()).toEqual([])
    })

    it('is not typed into a chat on screen while its composer holds words', async () => {
      vi.useFakeTimers()
      await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([photo()]))
      const unregister = registerOutboxRecovery('h\0w\0tab-a')
      const unpublish = publishOutboxChatIdle('h\0w\0tab-a', false)
      startDrainer()
      await advance(5 * 60_000)
      expect(tab.submitted).toEqual([])

      unpublish()
      publishOutboxChatIdle('h\0w\0tab-a', true)
      await advance(90_000)
      expect(tab.submitted).toEqual([TEXT])
      unregister()
    })
  })
})
