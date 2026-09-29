// Reported from the phone on 2026-09-29: "there was a response for this
// request already sent" but the chat did not show it, and the background
// processes running were not shown either.
//
// One way the code allows both. Once the lead's turn is over with background
// work still running (Orca holds the pane `working`, `monitoring` for shells),
// a Claude started by one of those background processes (a `claude -p` in a
// script, say) inherits the pane's ORCA_PANE_KEY and its hooks post as the
// pane, naming its own session and its own Claude transcript. The kept-session
// rule took "the lead's turn had ended" as leave to follow any new session,
// so the chat moved to the nested one: the lead's reply and its tasks left the
// screen. Confirmed through the real controller (the probe of 2026-09-29).
// A nested agent can start from a background process, not only from a tool
// call in a running turn (native-chat-kept-session.ts).
//
// The rows follow what Orca's hook listener publishes (vendored
// src/shared/agent-hook-listener/providers/claude-events.ts): the lead's Stop
// held `working` by background inventory, stamped `turnCompletedAt`, which
// Orca 1.4.216 carries on the TAB from the live hook row; a SessionStart that
// lands `done` with `sessionBoundary`; Claude's hooks name their transcript.
// Session ids, paths and words are placeholders.
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'

vi.mock('./use-mobile-session-view-mode', () => ({
  useMobileSessionViewMode: () => ({ isTabChatView: () => true, toggleTabChatView: vi.fn() })
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => null
}))
const subscribed = vi.hoisted(() => [] as { agent: string | null; sessionId: string | null }[])
vi.mock('./use-mobile-native-chat-session', () => ({
  useMobileNativeChatSession: (args: { agent: string | null; sessionId: string | null }) => {
    subscribed.push({ agent: args.agent, sessionId: args.sessionId })
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
import { resetBeaconWatches } from './agent-hud-beacon-liveness'
import { resetNativeChatKeptSessionsForTests } from './native-chat-kept-session-store'
import { useMobileNativeChatController, type MobileNativeChatController } from './use-mobile-native-chat-controller'

type Status = Record<string, unknown>
type Agent = 'claude' | 'codex'

const PANE = 'facefdf7-0000-4000-8000-000000000000:e52d973b-0000-4000-8000-000000000000'
const PROJECT = '/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Code-UI'
const claudeSession = (id: string) => ({ key: 'session_id', id, transcriptPath: `${PROJECT}/${id}.jsonl` })
const LEAD = '5f2d8c61-3b0e-4f7a-9c44-2e61d0a9b7c3'
const NESTED = '3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b'
const CLEARED = '0c1d2e3f-4a5b-4c6d-8e7f-8091a2b3c4d5'
const TURN_END = 1790705085923

/** The lead mid-turn, running a tool. */
const LEAD_WORKING: Status = {
  state: 'working',
  prompt: 'start the dev server in the background and review the diff',
  agentType: 'claude',
  toolName: 'Bash',
  updatedAt: 1790705000000,
  stateStartedAt: 1790704900000,
  stateHistory: [{ state: 'done', prompt: 'the prompt before', startedAt: 1790704800000 }],
  paneKey: PANE,
  tabId: 'tab-1',
  terminalTitle: '✳ Dev server',
  providerSession: claudeSession(LEAD)
}
/** Its Stop, held `working` by the background shell it started. */
const LEAD_BACKGROUND: Status = {
  ...LEAD_WORKING,
  workingMode: 'monitoring',
  toolName: undefined,
  lastAssistantMessage: 'The dev server is running in the background.',
  updatedAt: TURN_END
}
/** Orca's title stand-in once the title went idle after that Stop. */
const LEAD_STAND_IN: Status = {
  state: 'done',
  prompt: '',
  updatedAt: TURN_END + 300,
  stateStartedAt: TURN_END + 300,
  paneKey: PANE,
  stateHistory: [],
  agentType: 'claude',
  tabId: 'tab-1',
  terminalTitle: '✳ Dev server',
  providerSession: claudeSession(LEAD)
}
/** Another Claude's SessionStart on the pane: `done`, a session boundary. */
const sessionStart = (id: string, at: number): Status => ({
  state: 'done',
  prompt: '',
  sessionBoundary: true,
  agentType: 'claude',
  updatedAt: at,
  stateStartedAt: at,
  stateHistory: [],
  paneKey: PANE,
  providerSession: claudeSession(id)
})
const turnOf = (id: string, state: string, at: number, fields: Status = {}): Status => ({
  state,
  prompt: 'review the diff and list the risky hunks',
  agentType: 'claude',
  updatedAt: at,
  stateStartedAt: at,
  stateHistory: [{ state: 'done', prompt: '', startedAt: at - 1000 }],
  paneKey: PANE,
  providerSession: claudeSession(id),
  ...fields
})

describe('a Claude chat after its turn ended with background work running', () => {
  let renderer: ReactTestRenderer | null = null
  let controller: MobileNativeChatController | null = null
  let logged: string[] = []
  const clientStub = { sendRequest: vi.fn(), getState: () => 'connected' as const, notifyForeground: vi.fn() }

  function Chat({ tab }: { tab: Status }): null {
    controller = useMobileNativeChatController({
      client: clientStub as unknown as RpcClient,
      connState: 'connected',
      tabsLive: true,
      hostId: 'host-mac',
      worktreeId: 'code-ui::main',
      activeSessionTab: tab as never,
      activeSessionTabId: 'tab-1',
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
  /** The tab as the host sends it, and the session the chat then reads. */
  function show(status: Status, turnCompletedAt?: number, agent: Agent = 'claude'): string | null {
    // One tab object per snapshot, as the host sends one.
    const tab: Status = {
      type: 'terminal',
      id: 'tab-1',
      terminal: 'term-1',
      launchAgent: null,
      agentStatus: { ...status, agentType: status.agentType ?? agent },
      isActive: true,
      ...(turnCompletedAt === undefined ? {} : { turnCompletedAt })
    }
    act(() => {
      const element = createElement(Chat, { tab })
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
      }
    })
    return subscribed.at(-1)?.sessionId ?? null
  }

  beforeEach(() => {
    subscribed.length = 0
    logged = []
    resetAgentHudBeacons()
    resetBeaconWatches()
    resetNativeChatKeptSessionsForTests()
    for (const method of ['log', 'info', 'warn'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '))
      })
    }
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    controller = null
    vi.restoreAllMocks()
  })

  const nestedRun = () => {
    // Its SessionStart replaces the live hook row, so the tab no longer
    // carries the lead's turn end from here on.
    expect(show(sessionStart(NESTED, TURN_END + 20_000))).toBe(LEAD)
    expect(show(turnOf(NESTED, 'working', TURN_END + 21_000, { toolName: 'Read' }))).toBe(LEAD)
    expect(show(turnOf(NESTED, 'done', TURN_END + 40_000, { lastAssistantMessage: 'Two hunks look risky.' }))).toBe(LEAD)
  }

  it('stays on the lead’s session when a claude -p a background process started posts as the pane', () => {
    expect(show(LEAD_WORKING)).toBe(LEAD)
    expect(show(LEAD_BACKGROUND, TURN_END)).toBe(LEAD)
    nestedRun()
    expect(subscribed.map((entry) => entry.sessionId)).not.toContain(NESTED)
    expect(controller?.nativeChatAgentWorking).toBe(false)
    expect(logged).toContain("[native-chat] kept session 5f2d8c61 over 3e4f5a6b: it appeared while 5f2d8c61's background work ran (a nested agent on this pane)")
  })

  // Orca's title stand-in hides the Stop row at most turn ends; the tab's
  // turn end still says background work outlived the turn.
  it('stays on the lead’s session when the lead’s turn end reached the phone only as Orca’s title stand-in', () => {
    expect(show(LEAD_WORKING)).toBe(LEAD)
    expect(show(LEAD_STAND_IN, TURN_END)).toBe(LEAD)
    nestedRun()
  })

  it('stays on the lead’s session through a stand-in after the Stop row the phone did see', () => {
    show(LEAD_WORKING)
    show(LEAD_BACKGROUND, TURN_END)
    show(LEAD_STAND_IN, TURN_END)
    nestedRun()
  })

  it('follows the lead again when its own status comes back after the nested run', () => {
    show(LEAD_WORKING)
    show(LEAD_BACKGROUND, TURN_END)
    nestedRun()
    expect(show({ ...LEAD_BACKGROUND, updatedAt: TURN_END + 60_000 }, TURN_END)).toBe(LEAD)
  })

  // What must still switch.
  it('follows a /clear after a turn that left nothing running, at once', () => {
    show(LEAD_WORKING)
    show({ ...LEAD_WORKING, state: 'done', toolName: undefined, updatedAt: TURN_END })
    expect(show(sessionStart(CLEARED, TURN_END + 20_000))).toBe(CLEARED)
    expect(logged).toContain("[native-chat] switched session 5f2d8c61 to 0c1d2e3f (rule turn-ended): 5f2d8c61's turn had ended")
  })

  it('follows a /clear after a turn that left nothing running, when the Stop reached the phone only as a stand-in', () => {
    show(LEAD_WORKING)
    show(LEAD_STAND_IN)
    expect(show(sessionStart(CLEARED, TURN_END + 20_000))).toBe(CLEARED)
  })

  // /clear keeps the background tasks (2.1.284's clearConversation keeps every
  // backgrounded task), so the cleared session's own first Stop is held by
  // them: that says it owns the pane's work, which a nested run never does.
  it('follows a /clear made while background work ran once the new session’s own turn ends holding that work', () => {
    show(LEAD_WORKING)
    show(LEAD_BACKGROUND, TURN_END)
    expect(show(sessionStart(CLEARED, TURN_END + 20_000))).toBe(LEAD)
    expect(show(turnOf(CLEARED, 'working', TURN_END + 21_000))).toBe(LEAD)
    const heldByTheWork = turnOf(CLEARED, 'working', TURN_END + 40_000, { workingMode: 'monitoring', lastAssistantMessage: 'Done.' })
    expect(show(heldByTheWork, TURN_END + 40_000)).toBe(CLEARED)
    expect(logged).toContain(
      "[native-chat] switched session 5f2d8c61 to 0c1d2e3f (rule holds-background): 0c1d2e3f's own turn ended with the pane's background work still running"
    )
  })

  it('follows a /clear made while background work ran once the new session starts a second turn', () => {
    show(LEAD_WORKING)
    show(LEAD_BACKGROUND, TURN_END)
    show(sessionStart(CLEARED, TURN_END + 20_000))
    show(turnOf(CLEARED, 'working', TURN_END + 21_000))
    expect(show(turnOf(CLEARED, 'done', TURN_END + 30_000, { lastAssistantMessage: 'Done.' }))).toBe(LEAD)
    expect(show(turnOf(CLEARED, 'working', TURN_END + 50_000, { prompt: 'and the next file' }))).toBe(CLEARED)
    expect(logged).toContain("[native-chat] switched session 5f2d8c61 to 0c1d2e3f (rule second-turn): it started a second turn of its own")
  })

  it('follows a new claude in the pane after the lead exited, at once', () => {
    show(LEAD_WORKING)
    show(LEAD_BACKGROUND, TURN_END)
    // The lead exits and its shells with it; the title turns to the shell's,
    // and Orca's `done` for the pane copies none of the row's identity.
    const left: Status = { state: 'done', prompt: '', updatedAt: TURN_END + 5_000, stateStartedAt: TURN_END + 5_000, paneKey: PANE, stateHistory: [], agentType: 'claude', providerSession: claudeSession(LEAD) }
    show(left, TURN_END)
    expect(show(sessionStart(CLEARED, TURN_END + 20_000))).toBe(CLEARED)
  })

  it('follows the session the live beacon names, background work or not', () => {
    show(LEAD_WORKING)
    show(LEAD_BACKGROUND, TURN_END)
    act(() => {
      consumeAgentHudBeacons('term-1', `\u001b]7777;CUIHUD1 agent=claude sid=${CLEARED} hb=5 model=claude-opus-5-5\u0007`)
    })
    expect(show(sessionStart(CLEARED, TURN_END + 20_000))).toBe(CLEARED)
    expect(logged).toContain('[native-chat] switched session 5f2d8c61 to 0c1d2e3f (rule beacon): the claude beacon on this terminal names it')
  })

  it('switches on the first session the tab ever names, with nothing kept to hold', () => {
    expect(show(sessionStart(NESTED, TURN_END))).toBe(NESTED)
  })
})

// Codex: Orca holds a Codex pane `working` after the lead's own Stop while a
// sub-agent it tracks runs (vendored codex-subagent-roster.ts), with no
// `monitoring` mode and no turn end on the tab. That already reads as a turn
// still running, so a nested codex session posting as the pane is held off.
describe('a Codex chat whose lead ended its turn with a sub-agent running', () => {
  const ROLLOUTS = '/Users/alwinpaul/.codex/sessions/2026/09/29'
  const LEAD_CODEX = '01a0ee57-e8fd-7c20-a7a8-2159ced42f7c'
  const NESTED_CODEX = '01a0ee57-fed0-7e32-a53c-46ad52c9aa3a'
  const codexSession = (id: string) => ({ key: 'session_id', id, transcriptPath: `${ROLLOUTS}/rollout-2026-09-29T20-05-33-${id}.jsonl` })
  let renderer: ReactTestRenderer | null = null
  const codexClient = { sendRequest: vi.fn(), getState: () => 'connected' as const, notifyForeground: vi.fn() }
  function CodexChat({ tab }: { tab: Status }): null {
    useMobileNativeChatController({
      client: codexClient as unknown as RpcClient,
      connState: 'connected',
      tabsLive: true,
      hostId: 'host-mac',
      worktreeId: 'code-ui::main',
      activeSessionTab: tab as never,
      activeSessionTabId: 'tab-cx',
      activeHandle: 'term-cx',
      activeHandleRef: { current: 'term-cx' },
      deviceTokenRef: { current: null },
      nativeChatTranscriptIsLocalReadable: true,
      nativeChatInputLeaseReady: true,
      onSendError: vi.fn(),
      onSendResolved: vi.fn()
    })
    return null
  }
  function show(status: Status): string | null {
    const tab: Status = { type: 'terminal', id: 'tab-cx', terminal: 'term-cx', launchAgent: 'codex', agentStatus: status, isActive: true }
    act(() => {
      const element = createElement(CodexChat, { tab })
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
      }
    })
    return subscribed.at(-1)?.sessionId ?? null
  }
  beforeEach(() => {
    subscribed.length = 0
    resetNativeChatKeptSessionsForTests()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })

  it('stays on the lead’s session when a nested codex posts as the pane while the lead’s sub-agent runs', () => {
    const base = { agentType: 'codex', paneKey: PANE, stateHistory: [{ state: 'done', prompt: '', startedAt: 1 }] }
    expect(show({ ...base, state: 'working', prompt: 'spawn the sleeper', updatedAt: 1790705139000, stateStartedAt: 1790705133000, providerSession: codexSession(LEAD_CODEX) })).toBe(LEAD_CODEX)
    const heldBySubagent = { ...base, state: 'working', prompt: 'spawn the sleeper', updatedAt: 1790705142771, stateStartedAt: 1790705133000, lastAssistantMessage: 'lead done', subagents: [{ id: NESTED_CODEX, state: 'working', startedAt: 1790705139415 }], providerSession: codexSession(LEAD_CODEX) }
    expect(show(heldBySubagent)).toBe(LEAD_CODEX)
    const other = '019b0000-0000-7000-8000-000000000001'
    expect(show({ ...base, state: 'done', prompt: '', sessionBoundary: true, updatedAt: 1790705150000, stateStartedAt: 1790705150000, stateHistory: [], providerSession: codexSession(other) })).toBe(LEAD_CODEX)
  })
})
