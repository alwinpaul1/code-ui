import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'

// The controller composes many session hooks; the ones that would reach the
// transport are stubbed. The transcript hook is a recorder: which session the
// chat subscribes to is what this suite is about.
vi.mock('./use-mobile-session-view-mode', () => ({
  useMobileSessionViewMode: () => ({ isTabChatView: () => true, toggleTabChatView: vi.fn() })
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => null
}))
const subscribed: { agent: string | null; sessionId: string | null; transcriptPath: string | null }[] = []
vi.mock('./use-mobile-native-chat-session', () => ({
  useMobileNativeChatSession: (args: { agent: string | null; sessionId: string | null; transcriptPath: string | null }) => {
    subscribed.push({ agent: args.agent, sessionId: args.sessionId, transcriptPath: args.transcriptPath })
    return { messages: [], status: 'ready', transcriptLoading: false }
  }
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
vi.mock('./use-mobile-native-chat-prompts', () => ({
  useMobileNativeChatPrompts: () => ({ permission: null, question: null, detectedAsk: null, ask: null })
}))
vi.mock('./use-mobile-native-chat-answer-send', () => ({
  useMobileNativeChatAnswerSend: () => ({ answerAsk: vi.fn(), cancelPending: vi.fn() })
}))
vi.mock('./mobile-native-chat-permission-send', () => ({
  useMobileNativeChatPermissionSend: () => vi.fn()
}))
vi.mock('./use-mobile-native-chat-stop', () => ({ useMobileNativeChatStop: () => vi.fn() }))
vi.mock('./use-mobile-native-chat-file-search', () => ({
  useMobileNativeChatFileSearch: () => ({ nativeChatFilePaths: [], loadNativeChatFiles: vi.fn() })
}))

import { consumeAgentHudBeacons, resetAgentHudBeacons } from './agent-hud-beacon'
import { newBeaconWatch, resetBeaconWatches, writeBeaconWatch, writeOffBeaconWatch } from './agent-hud-beacon-liveness'
import type { MobileNativeChatController } from './use-mobile-native-chat-controller'

type Status = Record<string, unknown>

// ─── The real statuses, 2026-09-28 (session 76ba8f2f, tab "paper-review") ────
//
// The pane runs `claude -c` in the Thesis worktree. Claude, from its own Bash
// tool, launched Grok through the grok-build bridge; Grok inherited the pane's
// ORCA_PANE_KEY, so its hooks posted as this pane. Orca's saved row for it
// (`agent-hooks/last-status.json`, entry `ead6c845-…:1b0d472e-…`):
//
//   source: "grok", hookEventName: "PostToolUse",
//   providerSession: { key: "session_id", id: "5690de4f-8d81-4478-b1ae-5ec01e15451b" },
//   payload: { state: "working", prompt: "run the cancelled jobs do we need to do those",
//              agentType: "claude", toolName: "search_replace",
//              lastAssistantMessageIsToolOutput: true },
//   grokPromptBoundary: true, stateStartedAt: 1790546882183
//
// The phone never gets `source` or `grokPromptBoundary`
// (`pickParsedAgentStatusPayload`, src/shared/agent-status-types.ts), and
// Orca names the pane's owner, Claude, as `agentType`. What does reach it is
// that Grok's provider session names no transcript (`extractAgentProviderSession`
// keeps `transcript_path` for a Claude or Codex hook only), while every hook
// Claude Code fires names its own. Below: GROK is that row as the tab status
// carries it; CLAUDE is Claude's own row before it, the same fields plus the
// transcript path its hooks name. The path follows Claude Code's layout
// (`<config dir>/projects/<dashed cwd>/<session>.jsonl`); the transcript
// itself was not read.

const PANE = 'ead6c845-0000-4000-8000-000000000000:1b0d472e-0000-4000-8000-000000000000'
const CLAUDE_SESSION = '76ba8f2f-3727-4cbb-bfc4-3f09fba4d67b'
const CLAUDE_TRANSCRIPT = `/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Thesis/${CLAUDE_SESSION}.jsonl`
const GROK_SESSION = '5690de4f-8d81-4478-b1ae-5ec01e15451b'
const PROMPT = 'run the cancelled jobs do we need to do those'

const CLAUDE: Status = {
  state: 'working',
  prompt: PROMPT,
  agentType: 'claude',
  toolName: 'Bash',
  updatedAt: 1790549000000,
  stateStartedAt: 1790546882183,
  stateHistory: [],
  paneKey: PANE,
  providerSession: { key: 'session_id', id: CLAUDE_SESSION, transcriptPath: CLAUDE_TRANSCRIPT }
}

const GROK: Status = {
  state: 'working',
  prompt: PROMPT,
  agentType: 'claude',
  toolName: 'search_replace',
  lastAssistantMessageIsToolOutput: true,
  updatedAt: 1790549100000,
  stateStartedAt: 1790546882183,
  stateHistory: [],
  paneKey: PANE,
  providerSession: { key: 'session_id', id: GROK_SESSION }
}

/** Claude's Stop, once the Grok run hands back: its own session again, done. */
const CLAUDE_DONE: Status = {
  ...CLAUDE,
  state: 'done',
  toolName: undefined,
  lastAssistantMessage: 'Both jobs are back in the queue.',
  updatedAt: 1790552000000,
  stateStartedAt: 1790551884000
}

/** A `/clear`: Claude's SessionStart names the new session and the new file,
 *  which does not exist yet. */
const CLEARED_SESSION = '0c1d2e3f-4a5b-4c6d-8e7f-8091a2b3c4d5'
const CLAUDE_CLEARED: Status = {
  state: 'done',
  prompt: '',
  agentType: 'claude',
  sessionBoundary: true,
  updatedAt: 1790553000000,
  stateStartedAt: 1790553000000,
  stateHistory: [],
  paneKey: PANE,
  providerSession: {
    key: 'session_id',
    id: CLEARED_SESSION,
    transcriptPath: `/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Thesis/${CLEARED_SESSION}.jsonl`
  }
}

type ControllerModule = typeof import('./use-mobile-native-chat-controller')

const clientStub = { sendRequest: vi.fn(), getState: () => 'connected' as const, notifyForeground: vi.fn() }

function mountController(useController: ControllerModule['useMobileNativeChatController'], tab: { id: string; launchAgent: string | null }) {
  let controller: MobileNativeChatController | null = null
  function Harness({ agentStatus }: { agentStatus: Status }): null {
    controller = useController({
      client: clientStub as unknown as RpcClient,
      connState: 'connected',
      tabsLive: true,
      hostId: 'host-mac',
      worktreeId: 'thesis::main',
      activeSessionTab: { type: 'terminal', id: tab.id, terminal: 'term-1', launchAgent: tab.launchAgent, agentStatus, isActive: true } as never,
      activeSessionTabId: tab.id,
      activeHandle: 'term-1',
      activeHandleRef: { current: 'term-1' },
      deviceTokenRef: { current: null },
      nativeChatTranscriptIsLocalReadable: true,
      nativeChatInputLeaseReady: true,
      onSendError: vi.fn(),
      onSendResolved: vi.fn()
    })
    return null
  }
  let renderer: ReactTestRenderer | null = null
  return {
    show(agentStatus: Status) {
      act(() => {
        if (renderer) {
          renderer.update(createElement(Harness, { agentStatus }))
        } else {
          renderer = create(createElement(Harness, { agentStatus }))
        }
      })
    },
    get controller(): MobileNativeChatController {
      if (!controller) {
        throw new Error('the controller never rendered')
      }
      return controller
    },
    unmount() {
      act(() => renderer?.unmount())
      renderer = null
    }
  }
}

function lastSubscription() {
  const last = subscribed.at(-1)
  if (!last) {
    throw new Error('the chat never asked for a transcript')
  }
  return last
}

let mounted: ReturnType<typeof mountController> | null = null
let logged: string[] = []

async function freshStore() {
  return import('./native-chat-kept-session-store')
}

beforeEach(async () => {
  subscribed.length = 0
  logged = []
  resetAgentHudBeacons()
  resetBeaconWatches()
  ;(await freshStore()).resetNativeChatKeptSessionsForTests()
  for (const method of ['log', 'info', 'warn'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    })
  }
})

afterEach(() => {
  mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
})

async function mountClaudeTab(id: string) {
  const { useMobileNativeChatController } = await import('./use-mobile-native-chat-controller')
  mounted = mountController(useMobileNativeChatController, { id, launchAgent: null })
  return mounted
}

// Every case in this block is a host with no beacon at all: a Windows host
// gets no beacon flag (`hostTakesAgentHudFlag`), and a `claude -c` typed into
// a terminal runs with no status-line flag. The fix must hold there.
describe('a Claude chat whose pane a nested agent posts hooks for, with no beacon', () => {
  it('keeps a Claude chat on its own session when Grok, launched from its Bash tool, posts hooks on the same pane', async () => {
    const tab = await mountClaudeTab('tab-paper-review')
    tab.show(CLAUDE)
    expect(lastSubscription()).toEqual({ agent: 'claude', sessionId: CLAUDE_SESSION, transcriptPath: CLAUDE_TRANSCRIPT })
    const promptsBefore = tab.controller.nativeChatDesktopPrompts

    tab.show(GROK)

    // The transcript read stays on Claude's own session, where the history is.
    expect(lastSubscription()).toEqual({ agent: 'claude', sessionId: CLAUDE_SESSION, transcriptPath: CLAUDE_TRANSCRIPT })
    // Grok's row is not Claude's word about its turn: no Working row, no Stop,
    // and the chat's status for the tab is not that row.
    expect(tab.controller.nativeChatAgentWorking).toBe(false)
    expect(tab.controller.nativeChatCanStop).toBe(false)
    expect(tab.controller.nativeChatAgentStatus).toBeNull()
    // Nor does it bring a bubble of its own: the desk prompts are the ones
    // Claude's session already had.
    expect(tab.controller.nativeChatDesktopPrompts).toEqual(promptsBefore)
    // One line says what the chat did and why.
    expect(logged).toContain('[native-chat] kept session 76ba8f2f over 5690de4f: the new session named no transcript')
    // And the chat's files still resolve against Claude's session.
    expect(tab.controller.nativeChatSessionIdentity).toEqual({
      sessionId: CLAUDE_SESSION,
      transcriptPath: CLAUDE_TRANSCRIPT,
      nestedSessionId: GROK_SESSION
    })
  })

  it('keeps it through Grok’s whole stale run, whatever state Claude’s own last status said', async () => {
    const tab = await mountClaudeTab('tab-paper-review-ended')
    tab.show(CLAUDE_DONE)
    tab.show(GROK)
    tab.show({ ...GROK, updatedAt: 1790560000000, toolName: 'run_terminal_command' })

    // No transcript named: never a switch, turn ended or not.
    expect(lastSubscription()).toEqual({ agent: 'claude', sessionId: CLAUDE_SESSION, transcriptPath: CLAUDE_TRANSCRIPT })
    expect(tab.controller.nativeChatAgentWorking).toBe(false)
  })

  it('follows Claude again when its own status comes back after the nested run', async () => {
    const tab = await mountClaudeTab('tab-paper-review-2')
    tab.show(CLAUDE)
    tab.show(GROK)
    tab.show(CLAUDE_DONE)

    expect(lastSubscription()).toEqual({ agent: 'claude', sessionId: CLAUDE_SESSION, transcriptPath: CLAUDE_TRANSCRIPT })
    expect(tab.controller.nativeChatAgentStatus).toMatchObject({ state: 'done', providerSession: { id: CLAUDE_SESSION } })
    expect(tab.controller.nativeChatAgentWorking).toBe(false)
  })

  it('draws Working again from Claude’s own status once it returns working', async () => {
    const tab = await mountClaudeTab('tab-paper-review-3')
    tab.show(CLAUDE)
    tab.show(GROK)
    expect(tab.controller.nativeChatAgentWorking).toBe(false)
    tab.show({ ...CLAUDE, updatedAt: 1790549200000 })
    expect(tab.controller.nativeChatAgentWorking).toBe(true)
  })

  it('keeps a nested Claude, which names its own transcript, off the chat while the parent is mid-turn', async () => {
    // `claude -p` run from the parent's Bash tool: its hooks carry its own
    // transcript path, and Orca lets it replace the session (both are claude).
    const NESTED = '3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b'
    const tab = await mountClaudeTab('tab-nested-claude')
    tab.show(CLAUDE)
    tab.show({
      ...CLAUDE,
      prompt: 'check the queue for cancelled jobs',
      toolName: 'Bash',
      updatedAt: 1790549300000,
      providerSession: {
        key: 'session_id',
        id: NESTED,
        transcriptPath: `/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Thesis/${NESTED}.jsonl`
      }
    })

    expect(lastSubscription()).toEqual({ agent: 'claude', sessionId: CLAUDE_SESSION, transcriptPath: CLAUDE_TRANSCRIPT })
    expect(tab.controller.nativeChatAgentWorking).toBe(false)
    expect(tab.controller.nativeChatDesktopPrompts.map((prompt) => prompt.text)).not.toContain('check the queue for cancelled jobs')
    expect(logged).toContain(
      '[native-chat] kept session 76ba8f2f over 3e4f5a6b: it appeared while 76ba8f2f was mid-turn (a nested agent on this pane)'
    )
  })

  it('re-points to the new session a real /clear names, once Claude’s turn had ended', async () => {
    const tab = await mountClaudeTab('tab-paper-review-4')
    tab.show(CLAUDE)
    tab.show(GROK)
    tab.show(CLAUDE_DONE)
    tab.show(CLAUDE_CLEARED)

    expect(lastSubscription()).toEqual({
      agent: 'claude',
      sessionId: CLEARED_SESSION,
      transcriptPath: (CLAUDE_CLEARED.providerSession as { transcriptPath: string }).transcriptPath
    })
    expect(logged).toContain("[native-chat] switched session 76ba8f2f to 0c1d2e3f (rule turn-ended): 76ba8f2f's turn had ended")
  })

  it('re-points to a restarted claude in the same tab, once the last one’s turn had ended', async () => {
    const RESTARTED = '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d'
    const tab = await mountClaudeTab('tab-restarted-claude')
    tab.show(CLAUDE_DONE)
    // Claude exits; the pane's status keeps its last row until the next agent
    // reports. `claude` again: SessionStart names the new session and file.
    tab.show({
      ...CLAUDE_CLEARED,
      providerSession: {
        key: 'session_id',
        id: RESTARTED,
        transcriptPath: `/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Thesis/${RESTARTED}.jsonl`
      }
    })

    expect(lastSubscription().sessionId).toBe(RESTARTED)
  })

  it('moves to the new session once it starts a second turn, when the kept one died mid-turn', async () => {
    // The kept Claude was killed mid-turn and never said its turn ended (Orca
    // installs no SessionEnd for Claude); the new one is a real session. A
    // nested `claude -p` runs one prompt and exits, so a second turn of the
    // new session is the way out. Its first finished turn is not: a nested
    // Claude's Stop reaches the pane too.
    const tab = await mountClaudeTab('tab-dead-mid-turn')
    tab.show(CLAUDE)
    tab.show(CLAUDE_CLEARED)
    expect(lastSubscription().sessionId).toBe(CLAUDE_SESSION)
    const first = { ...CLAUDE_CLEARED, sessionBoundary: undefined, prompt: 'where were we' }
    tab.show({ ...first, state: 'working', updatedAt: 1790553500000 })
    tab.show({ ...first, state: 'done', lastAssistantMessage: 'We were re-running the cancelled jobs.', updatedAt: 1790554000000 })
    expect(lastSubscription().sessionId).toBe(CLAUDE_SESSION)
    tab.show({ ...first, state: 'working', prompt: 'carry on', updatedAt: 1790554100000 })

    expect(lastSubscription().sessionId).toBe(CLEARED_SESSION)
    expect(logged).toContain('[native-chat] switched session 76ba8f2f to 0c1d2e3f (rule second-turn): it started a second turn of its own')
  })

  // Review of b97b00d6: Orca suppresses a nested agent's `done` only when its
  // type differs from the pane's (resolveAgentStatusIdentity,
  // src/shared/agent-status-identity.ts). A nested Claude in a Claude pane
  // reports its Stop, and the chat moved to it, then back on the parent's
  // PostToolUse: A, then N, then A, in the middle of A's Bash call.
  it('keeps the chat on the parent through a nested claude -p’s whole run, its Stop included', async () => {
    const NESTED = '3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b'
    const nested = (state: string, extra: Status = {}): Status => ({
      ...CLAUDE,
      state,
      prompt: 'check the queue for cancelled jobs',
      updatedAt: 1790549300000 + Object.keys(extra).length + (state === 'done' ? 2000 : 1000),
      providerSession: {
        key: 'session_id',
        id: NESTED,
        transcriptPath: `/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Thesis/${NESTED}.jsonl`
      },
      ...extra
    })
    const tab = await mountClaudeTab('tab-nested-claude-stop')
    tab.show(CLAUDE)
    tab.show(nested('done', { sessionBoundary: true }))
    tab.show(nested('working'))
    tab.show(nested('done', { lastAssistantMessage: 'Two jobs were cancelled.' }))
    tab.show({ ...CLAUDE, toolName: 'Bash', updatedAt: 1790549400000 })

    expect(subscribed.map((entry) => entry.sessionId)).not.toContain(NESTED)
    expect(lastSubscription().sessionId).toBe(CLAUDE_SESSION)
  })

  // Review of b97b00d6: Orca reads a Claude assistant row with a null
  // stop_reason and prose or thinking as `completed`
  // (transcript-turn-lifecycle.ts; its own test "treats Claude assistant rows
  // with omitted stop_reason and content as completed"), and Claude Code
  // writes a turn's blocks as separate rows. A note before a tool call then
  // read as the end of the turn, and no later `working` status undid it.
  it('does not take a Claude transcript’s prose marker for the end of a turn its status says is running', async () => {
    const NESTED = '3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6c'
    const tab = await mountClaudeTab('tab-prose-marker')
    tab.show(CLAUDE)
    const store = await freshStore()
    act(() => store.noteNativeChatTranscriptTurn('claude', CLAUDE_SESSION, { state: 'completed' }))
    tab.show({ ...CLAUDE, toolName: 'Bash', updatedAt: 1790549350000 })
    tab.show({
      ...CLAUDE,
      updatedAt: 1790549360000,
      providerSession: {
        key: 'session_id',
        id: NESTED,
        transcriptPath: `/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Thesis/${NESTED}.jsonl`
      }
    })

    expect(lastSubscription().sessionId).toBe(CLAUDE_SESSION)
  })

  // Review of b97b00d6: a Claude parked on a question runs no tool, so nothing
  // nested can start under it. Quit there and restarted by hand, the new
  // session was held off the chat for its whole first turn.
  it('moves to a restarted claude when the last one was parked on a question', async () => {
    const tab = await mountClaudeTab('tab-restart-from-question')
    tab.show({ ...CLAUDE, state: 'waiting', toolName: 'AskUserQuestion' })
    tab.show(CLAUDE_CLEARED)

    expect(lastSubscription().sessionId).toBe(CLEARED_SESSION)
  })

  it('draws none of a status that names no transcript when nothing was ever kept for the tab', async () => {
    const tab = await mountClaudeTab('tab-never-seen')
    tab.show(GROK)

    // Nothing to keep: the chat asks for what the status names, the host
    // answers with no transcript, and the empty state says why. No Working
    // row, no Stop and no bubble stand over it.
    expect(lastSubscription()).toEqual({ agent: 'claude', sessionId: GROK_SESSION, transcriptPath: null })
    expect(tab.controller.nativeChatAgentWorking).toBe(false)
    expect(tab.controller.nativeChatCanStop).toBe(false)
    expect(tab.controller.nativeChatDesktopPrompts).toEqual([])
    expect(logged.some((line) => line.startsWith('[native-chat] no claude session kept for this tab; 5690de4f'))).toBe(true)
  })
})

// The beacon Claude's own status line writes to its PTY every few seconds
// carries the session of the process painting the terminal. On this tab that
// is Claude's 76ba8f2f while the status names Grok's 5690de4f. Extra evidence
// only: the cases above hold without it.
describe('the beacon of the Claude painting the terminal', () => {
  const ESC = '\u001b'
  const BEL = '\u0007'
  function beacon(sessionId: string, beat = ' hb=5') {
    act(() => {
      consumeAgentHudBeacons('term-1', `${ESC}]7777;CUIHUD1 agent=claude sid=${sessionId}${beat} model=claude-opus-5-5${BEL}`)
    })
  }

  it('reads the session the live beacon names over a nested status, with no session kept for the tab', async () => {
    const tab = await mountClaudeTab('tab-beacon')
    beacon(CLAUDE_SESSION)
    tab.show(GROK)

    // No transcript path is known for it, so the host finds the file by id.
    expect(lastSubscription()).toEqual({ agent: 'claude', sessionId: CLAUDE_SESSION, transcriptPath: null })
    expect(tab.controller.nativeChatAgentWorking).toBe(false)
    expect(tab.controller.nativeChatCanStop).toBe(false)
    expect(logged).toContain(
      '[native-chat] kept session 76ba8f2f over 5690de4f: the claude beacon on this terminal names 76ba8f2f (a nested agent on this pane)'
    )
  })

  it('keeps the transcript it knows for the session the beacon names', async () => {
    const tab = await mountClaudeTab('tab-beacon-kept')
    tab.show(CLAUDE)
    beacon(CLAUDE_SESSION)
    tab.show(GROK)

    expect(lastSubscription()).toEqual({ agent: 'claude', sessionId: CLAUDE_SESSION, transcriptPath: CLAUDE_TRANSCRIPT })
  })

  it('lets a live beacon naming the new session move the chat while the old turn is still open', async () => {
    const tab = await mountClaudeTab('tab-beacon-switch')
    tab.show(CLAUDE)
    beacon(CLEARED_SESSION)
    tab.show(CLAUDE_CLEARED)

    expect(lastSubscription().sessionId).toBe(CLEARED_SESSION)
    expect(logged).toContain('[native-chat] switched session 76ba8f2f to 0c1d2e3f (rule beacon): the claude beacon on this terminal names it')
  })

  it('does not take the session of a beacon the liveness watch has written off', async () => {
    const tab = await mountClaudeTab('tab-beacon-dead')
    beacon(CLAUDE_SESSION)
    writeBeaconWatch('term-1', writeOffBeaconWatch(newBeaconWatch(0), 1))
    tab.show(GROK)

    // A dead process's last word is no evidence: with nothing kept, as reported.
    expect(lastSubscription()).toEqual({ agent: 'claude', sessionId: GROK_SESSION, transcriptPath: null })
  })

  it('does not take the session of a beacon that declared no beat', async () => {
    const tab = await mountClaudeTab('tab-beacon-no-beat')
    beacon(CLAUDE_SESSION, '')
    tab.show(GROK)

    expect(lastSubscription()).toEqual({ agent: 'claude', sessionId: GROK_SESSION, transcriptPath: null })
  })
})

describe('a Codex chat whose pane a nested agent posts hooks for', () => {
  const CODEX_SESSION = '019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b'
  const CODEX_ROLLOUT = `/Users/alwinpaul/.codex/sessions/2026/09/27/rollout-2026-09-27T21-40-11-${CODEX_SESSION}.jsonl`
  const CODEX: Status = {
    state: 'working',
    prompt: 'port the queue parser',
    agentType: 'codex',
    updatedAt: 1790549000000,
    stateStartedAt: 1790548000000,
    stateHistory: [],
    paneKey: PANE,
    providerSession: { key: 'session_id', id: CODEX_SESSION, transcriptPath: CODEX_ROLLOUT }
  }
  // A `claude` typed into Codex's own shell tool inherits the pane key too; Orca
  // names the pane's owner, Codex, and keeps Claude's session and path.
  const NESTED_CLAUDE_SESSION = 'b7c8d9e0-1f2a-4b3c-8d4e-5f6a7b8c9d0e'
  const NESTED_CLAUDE: Status = {
    ...CODEX,
    prompt: 'summarise the diff',
    updatedAt: 1790549100000,
    providerSession: {
      key: 'session_id',
      id: NESTED_CLAUDE_SESSION,
      transcriptPath: `/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Code-UI/${NESTED_CLAUDE_SESSION}.jsonl`
    }
  }

  async function mountCodexTab(id: string) {
    const { useMobileNativeChatController } = await import('./use-mobile-native-chat-controller')
    mounted = mountController(useMobileNativeChatController, { id, launchAgent: 'codex' })
    return mounted
  }

  it('keeps a Codex chat on its own session when a Claude started from its shell posts on the same pane', async () => {
    const tab = await mountCodexTab('tab-codex')
    tab.show(CODEX)
    tab.show(NESTED_CLAUDE)

    expect(lastSubscription()).toEqual({ agent: 'codex', sessionId: CODEX_SESSION, transcriptPath: CODEX_ROLLOUT })
    expect(tab.controller.nativeChatAgentStatus).toBeNull()
    expect(logged).toContain(
      "[native-chat] kept session 019a2b3c over b7c8d9e0: the new session is a claude transcript, not codex's (a nested agent on this pane)"
    )
  })

  it('keeps a Codex chat on its own session when a nested Grok posts a session with no transcript', async () => {
    const tab = await mountCodexTab('tab-codex-2')
    tab.show(CODEX)
    tab.show({ ...GROK, agentType: 'codex' })

    expect(lastSubscription()).toEqual({ agent: 'codex', sessionId: CODEX_SESSION, transcriptPath: CODEX_ROLLOUT })
    expect(tab.controller.nativeChatAgentWorking).toBe(false)
  })

  it('moves a Codex chat to a new thread once the last one’s turn had ended', async () => {
    const NEXT = '019a2b3d-0000-7000-8000-000000000001'
    const tab = await mountCodexTab('tab-codex-3')
    tab.show({ ...CODEX, state: 'done' })
    tab.show({
      ...CODEX,
      state: 'working',
      prompt: 'new thread',
      providerSession: {
        key: 'session_id',
        id: NEXT,
        transcriptPath: `/Users/alwinpaul/.codex/sessions/2026/09/28/rollout-2026-09-28T01-02-03-${NEXT}.jsonl`
      }
    })

    expect(lastSubscription().sessionId).toBe(NEXT)
  })
})

// The phone is restarted while the nested row is still the pane's status: the
// first status the chat reads is Grok's. Only what the phone kept from the
// last run can say which session is Claude's. Last in the file: it resets the
// module registry.
describe('the first status after a restart is the nested one', () => {
  it('follows a new session that names its transcript on the first status after a restart', async () => {
    // Nothing the phone heard before the restart says the kept session is mid
    // turn, so a /clear made while the phone was closed is followed at once,
    // as before the kept session existed.
    const first = await import('./use-mobile-native-chat-controller')
    mounted = mountController(first.useMobileNativeChatController, { id: 'tab-cleared-while-closed', launchAgent: null })
    mounted.show(CLAUDE)
    mounted.unmount()
    await new Promise((resolve) => setTimeout(resolve, 700))

    vi.resetModules()
    const { hydrateSessionCaches } = await import('./session-caches-hydrate')
    await hydrateSessionCaches()
    const second = await import('./use-mobile-native-chat-controller')
    subscribed.length = 0
    mounted = mountController(second.useMobileNativeChatController, { id: 'tab-cleared-while-closed', launchAgent: null })
    mounted.show({ ...CLAUDE_CLEARED, state: 'working', sessionBoundary: undefined, prompt: 'new work' })

    expect(lastSubscription().sessionId).toBe(CLEARED_SESSION)
  })

  it('keeps the Claude session it saw on the tab before the app restarted', async () => {
    const first = await import('./use-mobile-native-chat-controller')
    mounted = mountController(first.useMobileNativeChatController, { id: 'tab-paper-review-restart', launchAgent: null })
    mounted.show(CLAUDE)
    mounted.unmount()
    // Persisted writes are debounced; let them land before the "restart".
    await new Promise((resolve) => setTimeout(resolve, 700))

    vi.resetModules()
    const { hydrateSessionCaches } = await import('./session-caches-hydrate')
    await hydrateSessionCaches()
    const second = await import('./use-mobile-native-chat-controller')
    subscribed.length = 0
    mounted = mountController(second.useMobileNativeChatController, { id: 'tab-paper-review-restart', launchAgent: null })
    mounted.show(GROK)

    expect(lastSubscription()).toEqual({ agent: 'claude', sessionId: CLAUDE_SESSION, transcriptPath: CLAUDE_TRANSCRIPT })
    expect(mounted.controller.nativeChatAgentWorking).toBe(false)
  })
})
