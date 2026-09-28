import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'

// The controller composes many session hooks; the ones that would reach the
// transport or disk are stubbed to a minimal shape. The screen poll and the
// prompt cards are REAL: this suite is about what the chat is told when the
// agent waits on a prompt, from the screen the poll reads and the hook status.
const peekTerminalTab = vi.fn()
vi.mock('./use-mobile-session-view-mode', () => ({
  useMobileSessionViewMode: () => ({
    isTabChatView: () => true,
    toggleTabChatView: vi.fn(),
    peekTerminalTab,
    endTerminalPeek: vi.fn()
  })
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => null
}))
// Stable, as the session hook's own state is: the prompt cards derive from it.
const session = { messages: [], status: 'ready', transcriptLoading: false }
vi.mock('./use-mobile-native-chat-session', () => ({
  useMobileNativeChatSession: () => session
}))
vi.mock('./use-mobile-structured-agent-session', () => ({
  useMobileStructuredAgentSession: () => ({
    session: { messages: [], status: 'ready', transcriptLoading: false, hasMore: false, loadingEarlier: false, loadEarlier: vi.fn() },
    isWorking: false,
    turnId: null,
    turnActivity: null,
    sendWithOutcome: vi.fn(),
    sendConditions: { client: null, sendable: false },
    cancel: vi.fn(),
    permission: null,
    question: null,
    optionSnapshot: [],
    optionSurface: { getSnapshot: () => [], setOption: vi.fn(), invokeAction: vi.fn(), subscribe: () => () => {} },
    pendingOptionId: null,
    respondPermission: vi.fn(),
    respondQuestion: vi.fn(),
    setStructuredOption: vi.fn(),
    invokeStructuredOption: vi.fn()
  })
}))
vi.mock('./use-mobile-native-chat-drafts', () => ({
  useMobileNativeChatDrafts: () => ({
    composerText: '',
    setComposerText: vi.fn(),
    pending: [],
    imagePreviewsByMessageId: {},
    captureSendOrigin: vi.fn(),
    getComposerEditGeneration: () => 0,
    readSeededLaunchDraft: () => null,
    readSeededLaunchDraftSeed: () => null,
    clearDraftForSend: vi.fn(),
    restoreRejectedDraft: vi.fn(),
    acceptSend: vi.fn(),
    holdUnconfirmedSend: vi.fn()
  })
}))
vi.mock('./use-mobile-native-chat-answer-send', () => ({
  useMobileNativeChatAnswerSend: () => ({ answerAsk: vi.fn(), cancelPending: vi.fn() })
}))
vi.mock('./mobile-native-chat-permission-send', () => ({
  useMobileNativeChatPermissionSend: () => vi.fn()
}))
vi.mock('./use-mobile-native-chat-stop', () => ({ useMobileNativeChatStop: () => vi.fn() }))
// Watched, not driven: whether the composer's draft may be echoed onto the TUI.
const mirrorEnabled: boolean[] = []
vi.mock('./use-mobile-native-chat-draft-mirror', () => ({
  useMobileNativeChatDraftMirror: (args: { enabled: boolean }) => {
    mirrorEnabled.push(args.enabled)
    return { settleBeforeSend: async () => {} }
  }
}))
vi.mock('./use-mobile-native-chat-file-search', () => ({
  useMobileNativeChatFileSearch: () => ({ nativeChatFilePaths: [], loadNativeChatFiles: vi.fn() })
}))

import { withCodexTerminalLock } from './codex-terminal-lock'
import {
  useMobileNativeChatController,
  type MobileNativeChatController
} from './use-mobile-native-chat-controller'

/** The screen rows under the fixture's `=== screen: … ===` marker. */
function readScreen(name: string): string[] {
  const text = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
  const rows = text.split('\n')
  return rows.slice(rows.findIndex((row) => /^=== screen: .* ===$/.test(row)) + 1)
}

// Claude Code 2.1.283, 2026-09-27: a background general-purpose subagent's
// Bash prompt. The phone's chat showed the lead's last message and "1 running
// task", and nothing else, for about eight hours.
// (A transcription of the user's screenshot, not a tmux capture; see the
// fixture's header for the bytes it cannot vouch for.)
const SUBAGENT_PROMPT = readScreen('claude-screen-subagent-bash-permission-2.1.283.txt')
const SUBAGENT_TITLE = ' Bash command · from the general-purpose agent'

// A Codex command approval as the phone saw it (codex-terminal-permission.test.ts,
// from a screenshot), under a question its reader does not know.
const CODEX_UNREAD = [
  'Would you like to apply the following change?',
  '',
  '  $ pnpm exec vitest run > /tmp/codeui-026-tests.log 2>&1',
  '',
  '› 1. Yes, proceed (y)',
  "  2. Yes, and don't ask again for commands that start with `pnpm exec vitest` (p)",
  '  3. No, and tell Codex what to do differently (esc)',
  '',
  'Press enter to confirm or esc to cancel'
]

// The edit dialog's rows as mobile-terminal-permission-options.test.ts pins
// them: the screen parser reads Bash only, so an Edit card comes from the hook.
const EDIT_PROMPT = [
  'Do you want to make this edit to about.tsx?',
  '❯ 1. Yes',
  '  2. Yes, allow all edits during this session (shift+tab)',
  '  3. No, and tell Claude what to do differently (esc)'
]

describe('what the chat says while the agent waits on a prompt', () => {
  let renderer: ReactTestRenderer | null = null
  let controller: MobileNativeChatController | null = null
  let screen: string[] | null = null
  const sendRequest = vi.fn(async (method: string) =>
    method === 'terminal.read' && screen
      ? { ok: true, result: { terminal: { lines: screen, source: 'screen' } } }
      : { ok: false, error: { code: 'unavailable', message: 'not in this test' } }
  )
  const clientStub = { sendRequest, getState: () => 'connected' as const, notifyForeground: vi.fn() }
  // Stable, as the route's own are: the screen poll restarts whenever its
  // handle ref changes, and a read that lands re-renders.
  const handleRef = { current: 'term-1' }
  const deviceTokenRef = { current: null }
  const onSendError = vi.fn()
  const onSendResolved = vi.fn()

  // One tab object per test, as the tab store hands over.
  function Harness({ tab }: { tab: object }): null {
    controller = useMobileNativeChatController({
      client: clientStub as unknown as RpcClient,
      connState: 'connected',
      tabsLive: true,
      hostId: 'h',
      worktreeId: 'w',
      activeSessionTab: tab as never,
      activeSessionTabId: 'tab-1',
      activeHandle: 'term-1',
      activeHandleRef: handleRef,
      deviceTokenRef,
      nativeChatTranscriptIsLocalReadable: true,
      nativeChatInputLeaseReady: true,
      onSendError,
      onSendResolved
    })
    return null
  }

  const OWN_TRANSCRIPT: Record<string, string> = {
    claude: '/Users/me/.claude/projects/-Users-me-Desktop-Project-Code-UI/session-1.jsonl',
    codex: '/Users/me/.codex/sessions/2026/09/27/rollout-2026-09-27T10-00-00-session-1.jsonl'
  }

  async function show(lines: string[] | null, agent = 'claude', state = 'working', status = {}) {
    screen = lines
    const tab = {
      type: 'terminal',
      id: 'tab-1',
      terminal: 'term-1',
      launchAgent: agent,
      // The transcript path each agent's own hooks name; a session with none
      // reads as a nested agent's (native-chat-kept-session.ts).
      agentStatus: { state, agentType: agent, providerSession: { id: 'session-1', transcriptPath: OWN_TRANSCRIPT[agent] }, ...status },
      isActive: true
    }
    await act(async () => {
      renderer = create(createElement(Harness, { tab }))
    })
  }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    controller = null
    screen = null
    peekTerminalTab.mockClear()
    mirrorEnabled.length = 0
  })

  // The hook said nothing about a wait: the phone showed "1 running task".
  it("shows the card for a subagent's Bash prompt, which the chat left silent", async () => {
    await show(SUBAGENT_PROMPT)
    expect(controller?.nativeChatPermission).toMatchObject({
      title: 'Allow Bash?',
      description: 'From the general-purpose agent',
      options: [
        { label: 'Yes', send: '1' },
        { label: 'Yes, and don’t ask again for: git *', send: '2' },
        { label: 'No', send: '3' }
      ]
    })
    expect(controller?.nativeChatTerminalWait).toBeNull()
  })

  it('says a Claude prompt it cannot read is waiting in the terminal, and takes the user there', async () => {
    // The same real screen under a title this reader does not know, as the
    // next build's decoration would be: nothing on it is proven, so no card.
    await show(SUBAGENT_PROMPT.map((row) => (row === SUBAGENT_TITLE ? `${row} · queued` : row)))
    expect(controller?.nativeChatPermission).toBeNull()
    expect(controller?.nativeChatTerminalWait).toEqual({ source: 'screen', kind: 'approval', choices: ['Yes', 'Yes, and don\u2019t ask again for: git *', 'No'] })
    act(() => controller?.openNativeChatTerminal())
    expect(peekTerminalTab).toHaveBeenCalledWith('tab-1')
  })

  // The TUI is reading keys as answers while any dialog is up, so a draft
  // echoed onto it could pick an option. The card gate alone let the mirror
  // type into a dialog no reader took.
  it('keeps the draft off the terminal while a prompt it cannot read is up', async () => {
    await show(SUBAGENT_PROMPT.map((row) => (row === SUBAGENT_TITLE ? `${row} · queued` : row)))
    expect(controller?.nativeChatTerminalWait).toMatchObject({ source: 'screen' })
    expect(mirrorEnabled.at(-1)).toBe(false)
  })

  it('says a Codex prompt it cannot read is waiting in the terminal', async () => {
    await show(CODEX_UNREAD, 'codex')
    expect(controller?.nativeChatPermission).toBeNull()
    expect(controller?.nativeChatTerminalWait).toEqual({ source: 'screen', kind: 'approval', choices: CODEX_UNREAD.slice(4, 7).map((row) => row.replace(/^\W*\d\. /, '')) })
  })

  // The prompts the hook does carry a card for keep it: an Edit approval's
  // card comes from the hook, with the choices the screen draws.
  it('keeps the hook card for an Edit prompt the screen parser does not read', async () => {
    const approval = JSON.stringify({ approval: { tool: 'Edit', summary: 'src/about.tsx' } })
    await show(EDIT_PROMPT, 'claude', 'waiting', { toolName: 'Edit', interactivePrompt: approval })
    expect(controller?.nativeChatPermission).toMatchObject({
      title: 'Allow Edit?',
      options: [
        { label: 'Yes', send: '1' },
        { label: 'Yes, allow all edits during this session (shift+tab)', send: '2' },
        { label: 'No, and tell Claude what to do differently (esc)', send: '3' }
      ]
    })
    expect(controller?.nativeChatTerminalWait).toBeNull()
  })

  // Codex 0.153.4's model picker (codex-picker-screen.test.ts), open on the desktop.
  const PICKER = [
    '• ok',
    '  Select Model and Effort',
    '  1. gpt-6-astra (default)  Our most capable model for complex, demanding work.',
    '› 2. gpt-5.6-sol (current)  Reliable agentic workhorse for everyday tasks.',
    '  Press enter to confirm or esc to go back'
  ]

  it('says a menu is open, not that approval waits, for a picker left open', async () => {
    await show(PICKER, 'codex')
    expect(controller?.nativeChatTerminalWait).toMatchObject({ source: 'screen', kind: 'menu' })
  })

  // The phone's own Codex pick opens that picker; the chat must not flash a
  // notice about its own menu while it drives it.
  it("raises nothing while the phone's own Codex pick holds the terminal", async () => {
    let finish!: () => void
    const pick = withCodexTerminalLock('term-1', () => new Promise<void>((resolve) => (finish = resolve)))
    await show(PICKER, 'codex')
    expect(controller?.nativeChatTerminalWait).toBeNull()
    await act(async () => {
      finish()
      await pick
    })
    await act(async () => {
      await controller?.refreshNativeChatHud()
    })
    expect(controller?.nativeChatTerminalWait).toMatchObject({ source: 'screen', kind: 'menu' })
  })

  it.each(['waiting', 'blocked'])(
    'says so from a %s hook status with no card, before the screen has been read',
    async (state) => {
      await show(null, 'claude', state)
      expect(controller?.nativeChatPermission).toBeNull()
      expect(controller?.nativeChatTerminalWait).toEqual({ source: 'hook' })
    }
  )

  it('stops once the screen saw the prompt leave, whatever the hook row still says', async () => {
    await show(SUBAGENT_PROMPT.map((row) => (row === SUBAGENT_TITLE ? `${row} · queued` : row)), 'claude', 'waiting')
    expect(controller?.nativeChatTerminalWait).toMatchObject({ source: 'screen' })
    screen = ['  session:ok', '', '❯\u00a0']
    await act(async () => {
      await controller?.refreshNativeChatHud()
    })
    expect(controller?.nativeChatTerminalWait).toBeNull()
  })

  // One detector for all four: the notice, the mirror, the send and the queue
  // edit count a dialog only as a menu at the live bottom of the screen, with
  // one of its own rows selected. A numbered Yes/No list in the lead's last
  // message, above Claude's input box, is not one.
  it('says nothing for a numbered Yes/No list in the conversation, and echoes the draft', async () => {
    const at = SUBAGENT_PROMPT.findIndex((row) => row.startsWith('\u2500'))
    await show([
      ...SUBAGENT_PROMPT.slice(0, at),
      '  1. Yes, merge it',
      '  2. No, keep the branch',
      '',
      '\u2500'.repeat(99),
      '\u276f\u00a0',
      '\u2500'.repeat(99)
    ])
    expect(controller?.nativeChatTerminalWait).toBeNull()
    expect(mirrorEnabled.at(-1)).toBe(true)
  })

  it('says nothing while nothing waits, and echoes the draft as before', async () => {
    await show(['  session:ok', '', '❯\u00a0'])
    expect(controller?.nativeChatTerminalWait).toBeNull()
    expect(mirrorEnabled.at(-1)).toBe(true)
  })
})
