// Reported 2026-10-17: "when a message is sent from the composer it takes time to appear, see how
// Claude handles it". The Claude app draws its pending row and empties the composer in the same
// frame as the tap (docs/claude-app-parity-gaps.md §3, `pending_message`); nothing it waits on
// comes first.
//
// On a terminal tab the phone looked at the desktop screen first (a dialog there takes typed keys
// as answers), and the composer emptied and the bubble was drawn only once that look came back:
// one terminal.read over the relay at the least (~250 ms behind a VPN), and up to three reads
// 400 ms apart while Claude repaints its box, which it does every second with background agents
// running, so mostly while it works. Then the draft mirror's flush. With a link that is up at the
// tap the box now empties and the bubble is drawn at the tap; the look still runs before anything
// is typed, and a refusal from it puts the words back and takes the bubble down, as the Claude
// app's failure does (row removed, words back, a Retry).
//
// Drives the REAL draft store, the REAL message send, the REAL image hook and the REAL screen look
// (readSendUnderDialogRefusal). Screens: Claude Code 2.1.296 at 46 columns, captured with
// `tmux capture-pane -p` on 2026-10-09 (send-exit-outbox-terminal.test.ts); Codex 0.158.0, REAL
// bytes (fixtures/codex-composer-screens.ts); the dialog is
// fixtures/claude-screen-subagent-bash-permission-2.1.283.txt.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { resetLiveNativeChatDraftsForTests } from './mobile-native-chat-live-drafts'
import { resetAppForegroundClockForTests } from './app-foreground-clock'
import { baseArgs, ok } from './use-mobile-native-chat-image-attachments.test-support'
import {
  hydrateNativeChatOutbox,
  nativeChatOutboxEntries,
  nativeChatOutboxWritesSettled,
  resetNativeChatOutboxForTests
} from '../storage/native-chat-outbox'
import { readNativeChatDraft } from '../storage/native-chat-drafts'
import { isOutboxSendLive, mountOutboxDrainer, publishOutboxChatRoute, resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { resetNativeChatSendTimingForTests } from './native-chat-send-timing'
import { OUTBOX_ECHO_PREFIX } from './mobile-native-chat-outbox-drafts'
import { readSendUnderDialogRefusal, SEND_UNDER_DIALOG_REFUSAL } from './mobile-native-chat-dialog-guard'
import { mobileNativeChatScopeKey } from './mobile-native-chat-scope-key'
import { parkRefusedComposerSend } from './native-chat-send-gate-outbox'
import { IDLE_AFTER_TURN_0158, WORKING_0158 } from './fixtures/codex-composer-screens'
import { createFakeComposerHost } from './fake-claude-composer-host.test-support'
import type { NativeChatTextSendStart } from './mobile-native-chat-text-send-start'

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
const claudeIdle = (input: string): string[] => [...STATUS, RULE, `❯ ${input}`, RULE, FOOTER]
/** Claude at work on an earlier message: its spinner over the box, the box free for the next. */
const claudeWorking = (input: string): string[] => [
  '❯ check the build',
  '✽ Sock-hopping… (1s · thinking)',
  ...STATUS,
  RULE,
  `❯ ${input}`,
  RULE,
  `${FOOTER} · ← …`
]

/** The screen rows under the fixture's `=== screen: … ===` marker. */
function readScreen(name: string): string[] {
  const text = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
  const rows = text.split('\n')
  return rows.slice(rows.findIndex((row) => /^=== screen: .* ===$/.test(row)) + 1)
}
// Claude Code 2.1.283: a subagent's Bash prompt with "Yes" highlighted.
const CLAUDE_DIALOG = readScreen('claude-screen-subagent-bash-permission-2.1.283.txt')

const TEXT = 'is everything fixed and done'
const SCOPE = mobileNativeChatScopeKey('h', 'w', 'tab-a')!

type Agent = 'claude' | 'codex'
type Screen = (input: string) => string[]

/** Each agent's idle and working screens with `input` in its box. */
const SCREENS: Record<Agent, { idle: Screen; working: Screen }> = {
  claude: { idle: claudeIdle, working: claudeWorking },
  codex: {
    idle: (input) => IDLE_AFTER_TURN_0158.map((row) => (row.startsWith('› ') ? `› ${input}` : row)),
    working: (input) => WORKING_0158.map((row) => (row.startsWith('› ') ? `› ${input}` : row))
  }
}

/**
 * A desktop tab whose screen reads wait until `answerLooks` is called: the relay round trip the
 * look spends, held open so the test can see what the phone draws meanwhile.
 */
function desktop(screen: Screen) {
  let input = ''
  let answer: () => void = () => {}
  const looksAnswered = new Promise<void>((resolve) => {
    answer = resolve
  })
  const state = {
    submittedBodies: [] as string[],
    reads: 0,
    /** What the screen shows from here, whatever is in the box. */
    shows: null as string[] | null,
    answerLooks: () => answer(),
    client: null as unknown as RpcClient
  }
  state.client = {
    getState: () => 'connected',
    notifyForeground: vi.fn(),
    getLastConnectedAt: () => 1,
    sendRequest: vi.fn(async (method: string, params: { text?: string; enter?: boolean }) => {
      if (method === 'terminal.read') {
        state.reads += 1
        await looksAnswered
        const lines = state.shows ?? screen(input)
        return ok('r', { terminal: { source: 'screen', tail: lines, lines, draft: '' } })
      }
      if (method !== 'terminal.send') {
        return ok('x', {})
      }
      // Claude's body rides with its Enter; Codex's is typed first and handed over with a Tab.
      if (params.enter === true || params.text === '\t') {
        state.submittedBodies.push(params.enter === true && params.text ? params.text : input)
        input = ''
        return ok('s', { send: { accepted: true } })
      }
      input = params.text ?? ''
      return ok('s', { send: { accepted: true } })
    })
  } as unknown as RpcClient
  return state
}

describe.each(['claude', 'codex'] as const)('a %s chat message tapped Send on', (agent) => {
  let renderer: ReactTestRenderer | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
  let images: ReturnType<typeof useMobileNativeChatImageAttachments> | null = null
  const notices: Array<{ message: string; retry?: boolean }> = []
  const unmounts: Array<() => void> = []

  beforeEach(() => {
    notices.length = 0
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
    for (const unmount of unmounts.splice(0)) {
      unmount()
    }
    resetLiveNativeChatDraftsForTests()
    resetAppForegroundClockForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    await clearNativeChatDraftStores()
  })

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
      const report = (message: string, details?: { retry?: boolean }): void => {
        notices.push(details?.retry ? { message, retry: true } : { message })
      }
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
        showSendingEcho: drafts.showSendingEcho,
        acceptSend: drafts.acceptSend,
        holdUnconfirmedSend: drafts.holdUnconfirmedSend,
        onSendError: report
      })
      images = useMobileNativeChatImageAttachments(
        baseArgs({
          client,
          agent,
          scopeKey: SCOPE,
          hostTerminalOfTab: () => 'term-1',
          refuseUnderDialog: readSendUnderDialogRefusal,
          beginImageSend: drafts.clearDraftAtSendStart,
          beginTextSend: drafts.beginTextSendAtTap,
          // As the controller builds it (use-mobile-native-chat-controller.ts).
          parkRefusedSend: (text) =>
            parkRefusedComposerSend({ text, captureSendOrigin: drafts!.captureSendOrigin, clearDraftForSend: drafts!.clearDraftForSend, showSendingEcho: drafts!.showSendingEcho }),
          onSendError: report,
          baseSend: (text, previews, deadline, _attachments, follow) =>
            send.sendWithOutcome(text, previews, deadline, follow)
        })
      )
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

  /** Types `text` and taps Send; returns as soon as the tap's own frame is drawn. */
  async function typeAndTap(text: string): Promise<{ sending: Promise<boolean> }> {
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
    return { sending: sending! }
  }

  async function settle(sending: Promise<boolean>): Promise<boolean | 'pending'> {
    let result: boolean | 'pending' = 'pending'
    void sending.then((value) => {
      result = value
    })
    for (let step = 0; step < 100 && result === 'pending'; step += 1) {
      await advance(100)
    }
    return result
  }

  const bubbles = (): string[] =>
    drafts!.pending.filter((item) => item.id.startsWith(OUTBOX_ECHO_PREFIX)).map((item) => item.text)

  /** The app-wide drainer at the root and this chat's route, as the app has them. */
  function outboxCanSendIt(): void {
    unmounts.push(mountOutboxDrainer())
    unmounts.push(
      publishOutboxChatRoute(SCOPE, {
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-a',
        lane: 'terminal',
        agent,
        sessionId: 'session-1',
        terminal: 'term-1',
        transcriptPath: null
      })
    )
  }

  it.each(['idle', 'working'] as const)(
    'shows its bubble and empties the box at the tap while the agent is %s, before the desktop screen has answered',
    async (state) => {
      const tab = desktop(SCREENS[agent][state])
      mount(tab.client)
      const { sending } = await typeAndTap(TEXT)

      // The look is out and nothing has been typed.
      expect(tab.reads).toBeGreaterThan(0)
      expect(tab.submittedBodies).toEqual([])
      expect(drafts!.composerText).toBe('')
      expect(bubbles()).toEqual([TEXT])

      tab.answerLooks()
      expect(await settle(sending)).toBe(true)
      expect(tab.submittedBodies).toEqual([TEXT])
      // One bubble for the press, the one drawn at the tap.
      expect(bubbles()).toEqual([TEXT])
      expect(drafts!.composerText).toBe('')
      expect(notices).toEqual([])
    }
  )

  it('keeps its words through a kill while the screen look is out: in the outbox, not lost with the emptied box', async () => {
    const tab = desktop(SCREENS[agent].idle)
    mount(tab.client)
    await typeAndTap(TEXT)
    expect(drafts!.composerText).toBe('')
    await act(async () => {
      await nativeChatOutboxWritesSettled()
    })

    // The process dies here: storage is all the next one has.
    resetNativeChatOutboxForTests()
    await hydrateNativeChatOutbox()
    const [entry] = nativeChatOutboxEntries()
    expect(entry?.text).toBe(TEXT)
    // Not a gate entry: those are dropped on the next read, as their words stayed in the box.
    expect(entry?.atGate).toBeUndefined()
    expect((await readNativeChatDraft(SCOPE)) ?? '').toBe('')
  })

  if (agent === 'claude') {
    it('puts the words back and takes the bubble down when the look finds a dialog, with a Retry', async () => {
      const tab = desktop(SCREENS.claude.idle)
      tab.shows = CLAUDE_DIALOG
      mount(tab.client)
      const { sending } = await typeAndTap(TEXT)
      expect(bubbles()).toEqual([TEXT])

      tab.answerLooks()
      expect(await settle(sending)).toBe(false)
      expect(tab.submittedBodies).toEqual([])
      expect(drafts!.composerText).toBe(TEXT)
      expect(bubbles()).toEqual([])
      expect(nativeChatOutboxEntries()).toEqual([])
      expect(notices).toEqual([{ message: SEND_UNDER_DIALOG_REFUSAL, retry: true }])
    })
  }

  it('puts the words back once, the bubble down, when the desktop refuses the write after the look', async () => {
    const tab = desktop(SCREENS[agent].idle)
    mount(tab.client)
    const answer = tab.client.sendRequest as unknown as (method: string, params: { text?: string; enter?: boolean }) => Promise<unknown>
    tab.client.sendRequest = vi.fn(async (method: string, params: { text?: string; enter?: boolean }) =>
      method === 'terminal.send' && params.text === TEXT ? ok('s', { send: { accepted: false } }) : answer(method, params)
    ) as never
    const { sending } = await typeAndTap(TEXT)
    expect(bubbles()).toEqual([TEXT])

    tab.answerLooks()
    expect(await settle(sending)).toBe(false)
    // The send's own give-back and the image hook's catch-all both run here; the words show once.
    expect(drafts!.composerText).toBe(TEXT)
    expect(bubbles()).toEqual([])
    expect(nativeChatOutboxEntries()).toEqual([])
    expect(notices.map((notice) => notice.retry)).toEqual([true])
  })

  it('gives its words back only once, even after the user typed more under them', async () => {
    const tab = desktop(SCREENS[agent].idle)
    mount(tab.client)
    await act(async () => {
      drafts!.setComposerText(TEXT)
    })
    let start: NativeChatTextSendStart | null = null
    await act(async () => {
      start = drafts!.beginTextSendAtTap(TEXT)
    })
    expect(drafts!.composerText).toBe('')
    await act(async () => {
      start!.giveBack()
    })
    await act(async () => {
      drafts!.setComposerText(`${TEXT}\n\nand the tests`)
    })
    // A second refusal of the same press (the send's own after the image hook's, or the reverse).
    await act(async () => {
      drafts!.restoreRejectedDraft(start!.origin, TEXT)
    })
    expect(drafts!.composerText).toBe(`${TEXT}\n\nand the tests`)
    expect(bubbles()).toEqual([])
  })

  it('leaves it in the outbox, its bubble up and the box empty, when the screen shows no input box', async () => {
    outboxCanSendIt()
    const tab = desktop(SCREENS[agent].idle)
    tab.shows = ['hi', 'user@host ~ % ']
    mount(tab.client)
    const { sending } = await typeAndTap(TEXT)

    tab.answerLooks()
    expect(await settle(sending)).toBe(true)
    expect(tab.submittedBodies).toEqual([])
    expect(drafts!.composerText).toBe('')
    expect(bubbles()).toEqual([TEXT])
    const [entry] = nativeChatOutboxEntries()
    expect(entry?.text).toBe(TEXT)
    expect(entry?.unwritten).toBe(true)
    expect(isOutboxSendLive(entry!.id)).toBe(false)
    expect(notices).toHaveLength(1)
    expect(notices[0]!.message).toMatch(/input box isn't on the desktop screen/)
  })

  it('puts the words back with no bubble when the screen shows no input box and nothing could send it later', async () => {
    const tab = desktop(SCREENS[agent].idle)
    tab.shows = ['hi', 'user@host ~ % ']
    mount(tab.client)
    const { sending } = await typeAndTap(TEXT)

    tab.answerLooks()
    expect(await settle(sending)).toBe(false)
    expect(tab.submittedBodies).toEqual([])
    expect(drafts!.composerText).toBe(TEXT)
    expect(bubbles()).toEqual([])
    expect(nativeChatOutboxEntries()).toEqual([])
    expect(notices).toHaveLength(1)
    expect(notices[0]!.retry).toBe(true)
  })
})

// The tab given a new terminal during the look (a PTY restart): the send follows it, restarted
// from the top, as use-mobile-native-chat-image-attachments.remint-e2e.test.ts drives it. The
// press stays one origin: one bubble, one outbox entry, the words typed once.
describe('a Claude chat message whose tab gets a new terminal during the look', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
  let images: ReturnType<typeof useMobileNativeChatImageAttachments> | null = null
  const notices: Array<{ message: string; retry?: boolean }> = []
  const activeHandleRef = { current: 'term-1' as string | null }
  let hostTerminal = 'term-1'

  beforeEach(() => {
    notices.length = 0
    activeHandleRef.current = 'term-1'
    hostTerminal = 'term-1'
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
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

  /** term-1's first read moves the tab to term-2: a fake Claude Code input (the remint suite's),
   *  or, with `shell`, a terminal that shows a shell prompt and no composer. */
  function desktopRestartingUnderTheLook(shell = false) {
    const claude = createFakeComposerHost()
    const state = { submitted: claude.submitted, toOld: [] as string[], toNewWrites: 0, client: null as unknown as RpcClient }
    state.client = {
      getState: () => 'connected',
      notifyForeground: vi.fn(),
      getLastConnectedAt: () => 1,
      sendRequest: vi.fn(async (method: string, params: { terminal?: string }) => {
        if (params.terminal === 'term-1') {
          state.toOld.push(method)
          activeHandleRef.current = 'term-2'
          hostTerminal = 'term-2'
          const lines = claudeIdle('')
          return ok('r', { terminal: { source: 'screen', tail: lines, lines, draft: '' } })
        }
        if (shell) {
          state.toNewWrites += method === 'terminal.send' ? 1 : 0
          return ok('r', { terminal: { source: 'screen', lines: ['alwin@mac Code UI % '] } })
        }
        return claude.handle(method, params)
      })
    } as unknown as RpcClient
    return state
  }

  function mount(client: RpcClient): void {
    function ChatScreen(): null {
      drafts = useMobileNativeChatDrafts({ hostId: 'h', worktreeId: 'w', tabId: 'tab-a', sessionId: 'session-1', messages: [], transcriptSettled: true })
      const report = (message: string, details?: { retry?: boolean }): void => {
        notices.push(details?.retry ? { message, retry: true } : { message })
      }
      const send = useMobileNativeChatMessageSend({
        client,
        enabled: true,
        handleRef: activeHandleRef,
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
        onSendError: report
      })
      images = useMobileNativeChatImageAttachments(
        baseArgs({
          client,
          agent: 'claude',
          scopeKey: SCOPE,
          activeHandleRef,
          hostTerminalOfTab: () => hostTerminal,
          refuseUnderDialog: readSendUnderDialogRefusal,
          beginImageSend: drafts.clearDraftAtSendStart,
          beginTextSend: drafts.beginTextSendAtTap,
          onSendError: report,
          baseSend: (text, previews, deadline, _attachments, follow) => send.sendWithOutcome(text, previews, deadline, follow)
        })
      )
      return null
    }
    act(() => {
      renderer = create(createElement(ChatScreen))
    })
  }

  async function typeAndSend(text: string): Promise<boolean> {
    await act(async () => {
      drafts!.setComposerText(text)
    })
    vi.useFakeTimers()
    let sent = false
    await act(async () => {
      const sending = images!.sendNativeChat(text)
      await vi.runAllTimersAsync()
      sent = await sending
    })
    return sent
  }

  const bubbles = (): string[] =>
    drafts!.pending.filter((item) => item.id.startsWith(OUTBOX_ECHO_PREFIX)).map((item) => item.text)

  it('types it once into the new terminal, under the one bubble drawn at the tap', async () => {
    const tab = desktopRestartingUnderTheLook()
    mount(tab.client)
    expect(await typeAndSend(TEXT)).toBe(true)
    expect(tab.toOld).toEqual(['terminal.read'])
    expect(tab.submitted).toEqual([TEXT])
    expect(bubbles()).toEqual([TEXT])
    expect(drafts!.composerText).toBe('')
    expect(notices).toEqual([])
  })

  it('puts the words back and takes the bubble down when the new terminal shows no composer', async () => {
    const tab = desktopRestartingUnderTheLook(true)
    mount(tab.client)
    expect(await typeAndSend(TEXT)).toBe(false)
    expect(tab.toNewWrites).toBe(0)
    expect(drafts!.composerText).toBe(TEXT)
    expect(bubbles()).toEqual([])
    expect(nativeChatOutboxEntries()).toEqual([])
    expect(notices).toHaveLength(1)
  })
})
