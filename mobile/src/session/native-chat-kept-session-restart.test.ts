// A session's own restart, an inherited claim, and a phone prompt the phone
// never saw the lead take: the third review of the background rule
// (native-chat-kept-session.ts, 4b09c9a8). Same harness as
// native-chat-kept-session-gaps.test.ts; the listener cases feed Orca's real
// vendored hook listener, and `feed` posts a hook the phone never renders (a
// snapshot Orca coalesced away, or one sent while the phone was not watching).
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHookListenerState } from '../../../src/shared/agent-hook-listener/listener-state'
import { normalizeAndAccept, PANE_KEY } from '../../../src/shared/agent-hook-listener-test-harness'
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

import { resetAgentHudBeacons } from './agent-hud-beacon'
import { resetBeaconWatches } from './agent-hud-beacon-liveness'
import { notePhoneTerminalSend, resetNativeChatKeptSessionsForTests } from './native-chat-kept-session-store'
import { noteTurn, readTurn } from './native-chat-kept-session-state'
import { useMobileNativeChatController } from './use-mobile-native-chat-controller'

type Status = Record<string, unknown>

const PANE = 'facefdf7-0000-4000-8000-000000000000:e52d973b-0000-4000-8000-000000000000'
const PROJECT = '/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Code-UI'
const claudeSession = (id: string) => ({ key: 'session_id', id, transcriptPath: `${PROJECT}/${id}.jsonl` })
const LEAD = '5f2d8c61-3b0e-4f7a-9c44-2e61d0a9b7c3'
const NESTED = '3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b'
const CLEARED = '0c1d2e3f-4a5b-4c6d-8e7f-8091a2b3c4d5'
const NEXT = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d'
const TURN_END = 1790705085923
const MINUTE = 60_000

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
const LEAD_BACKGROUND: Status = { ...LEAD_WORKING, workingMode: 'monitoring', toolName: undefined, lastAssistantMessage: 'Running.', updatedAt: TURN_END }
const standIn = (at: number, extra: Status = {}): Status => ({
  state: 'done',
  prompt: '',
  updatedAt: at,
  stateStartedAt: at,
  paneKey: PANE,
  stateHistory: [],
  agentType: 'claude',
  tabId: 'tab-1',
  terminalTitle: '✳ Dev server',
  providerSession: claudeSession(LEAD),
  ...extra
})
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
  prompt: 'review the diff',
  agentType: 'claude',
  updatedAt: at,
  stateStartedAt: at,
  stateHistory: [{ state: 'done', prompt: '', startedAt: at - 1000 }],
  paneKey: PANE,
  providerSession: claudeSession(id),
  ...fields
})

function harness() {
  let renderer: ReactTestRenderer | null = null
  const clientStub = { sendRequest: vi.fn(), getState: () => 'connected' as const, notifyForeground: vi.fn() }
  function Chat({ tab }: { tab: Status }): null {
    useMobileNativeChatController({
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
  function show(status: Status, turnCompletedAt?: number): string | null {
    const tab: Status = {
      type: 'terminal',
      id: 'tab-1',
      terminal: 'term-1',
      launchAgent: null,
      agentStatus: { ...status, agentType: status.agentType ?? 'claude' },
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
  return {
    show,
    unmount: () => {
      act(() => renderer?.unmount())
      renderer = null
    }
  }
}

describe('a claim to background work through a restart, a dialog and a /clear', () => {
  let h = harness()
  beforeEach(() => {
    subscribed.length = 0
    h = harness()
    resetAgentHudBeacons()
    resetBeaconWatches()
    resetNativeChatKeptSessionsForTests()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    h.unmount()
    vi.restoreAllMocks()
  })

  // 4b09c9a8 kept `background` through a session's own boundary. The lead
  // left holding a shell (the exit reads as the stand-in, Orca's PTY last
  // resort) and came back as the SAME session (`claude --resume <id>`): its
  // SessionStart did not end the dead claim, so a /clear typed at the desk
  // before any prompt waited. A session's own boundary is its process
  // restarting: its claim ends.
  it('follows a desk /clear after the lead came back as the same session following an exit that held background work', () => {
    h.show(LEAD_WORKING)
    h.show(LEAD_BACKGROUND, TURN_END)
    h.show(standIn(TURN_END + 5_000, { terminalHandle: 'term-1', worktreeId: 'code-ui::main' }), TURN_END)
    expect(h.show(sessionStart(LEAD, TURN_END + 20_000))).toBe(LEAD)
    expect(h.show(sessionStart(CLEARED, TURN_END + 40_000))).toBe(CLEARED)
  })

  // The guard itself, as a unit: a dialog note never ends a claim, a
  // boundary ends a claim the session made itself and keeps one it inherited
  // from the phone's /clear.
  it('ends a claim on the session’s own boundary, and keeps it through a dialog or an inherited claim’s boundary', () => {
    act(() => noteTurn('claude', LEAD, 'background', true, false, TURN_END, TURN_END))
    act(() => noteTurn('claude', LEAD, 'ended', false, false, null, TURN_END + 10_000))
    expect(readTurn('claude', LEAD)?.turn).toBe('background')
    act(() => noteTurn('claude', LEAD, 'ended', false, false, null, TURN_END + 20_000, { boundary: true }))
    expect(readTurn('claude', LEAD)?.turn).toBe('ended')
    act(() => noteTurn('claude', CLEARED, 'background', false, false, TURN_END, TURN_END, { inherited: true }))
    act(() => noteTurn('claude', CLEARED, 'ended', false, false, null, TURN_END + 30_000, { boundary: true }))
    expect(readTurn('claude', CLEARED)?.turn).toBe('background')
  })

  // A background agent's permission prompt (Orca's child-induced `waiting`, on
  // the lead's session) keeps the claim.
  it('keeps the lead held while one of its background agents waits on a permission prompt', () => {
    h.show(LEAD_WORKING)
    h.show({ ...LEAD_BACKGROUND, workingMode: undefined }, TURN_END)
    h.show({ ...LEAD_WORKING, state: 'waiting', toolName: 'Bash', updatedAt: TURN_END + 60_000 })
    expect(h.show(sessionStart(NESTED, TURN_END + 70_000))).toBe(LEAD)
  })

  // A limit, pinned: the session the phone's /clear started inherits the
  // lead's claim. When that work is gone before the new session runs a turn
  // (and Orca, whose SessionStart dropped the pane's inventory, never says
  // so), a second /clear at the desk waits for the new session's second turn,
  // the beacon, a phone rule or the 30 minutes; the cleared session's own
  // first Stop ends the claim sooner.
  it('waits on a desk /clear made after the phone’s /clear before any turn, once the lead’s background work is gone (a limit)', () => {
    h.show(LEAD_WORKING)
    h.show(LEAD_BACKGROUND, TURN_END)
    act(() => notePhoneTerminalSend('term-1', '/clear', TURN_END + 10_000))
    expect(h.show(sessionStart(CLEARED, TURN_END + 10_500))).toBe(CLEARED)
    // (the dev server is stopped; nothing reaches Orca about it)
    expect(h.show(sessionStart(NEXT, TURN_END + 5 * MINUTE))).toBe(CLEARED)
    expect(h.show(turnOf(NEXT, 'working', TURN_END + 31 * MINUTE))).toBe(NEXT)
  })

  // A stamp-less claim is timed from the first status that made it, and
  // repeating the same claim with later rows does not move that anchor.
  it('times a stamp-less claim from its first status, whatever later rows repeat it', () => {
    h.show(LEAD_WORKING)
    h.show(LEAD_BACKGROUND)
    h.show({ ...LEAD_BACKGROUND, updatedAt: TURN_END + 20 * MINUTE })
    h.show({ ...LEAD_BACKGROUND, updatedAt: TURN_END + 29 * MINUTE })
    expect(h.show(turnOf(CLEARED, 'working', TURN_END + 31 * MINUTE))).toBe(CLEARED)
  })
})

describe('the phone’s follow-up through Orca’s per-pane prompt, when the phone missed the lead taking it', () => {
  let renderer: ReactTestRenderer | null = null
  let clock = TURN_END
  const clientStub = { sendRequest: vi.fn(), getState: () => 'connected' as const, notifyForeground: vi.fn() }
  function Chat({ tab }: { tab: Status }): null {
    useMobileNativeChatController({
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
  type State = ReturnType<typeof createHookListenerState>
  function feed(state: State, session: string, hook: string, extra: Status = {}): Status | undefined {
    clock += 1000
    return normalizeAndAccept(state, 'claude', {
      hook_event_name: hook,
      session_id: session,
      transcript_path: claudeSession(session).transcriptPath,
      cwd: '/tmp',
      ...extra
    })?.payload as Status | undefined
  }
  function post(state: State, session: string, hook: string, extra: Status = {}) {
    const payload = feed(state, session, hook, extra)
    if (!payload) {
      return { payload: null, session: subscribed.at(-1)?.sessionId ?? null }
    }
    const { turnCompletedAt, ...rest } = payload
    const tab: Status = {
      type: 'terminal',
      id: 'tab-1',
      terminal: 'term-1',
      launchAgent: null,
      agentStatus: {
        ...rest,
        paneKey: PANE_KEY,
        updatedAt: clock,
        stateStartedAt: clock,
        stateHistory: [{ state: 'done', prompt: '', startedAt: clock - 5000 }],
        tabId: 'tab-1',
        providerSession: claudeSession(session)
      },
      isActive: true,
      ...(typeof turnCompletedAt === 'number' ? { turnCompletedAt } : {})
    }
    act(() => {
      const element = createElement(Chat, { tab })
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
      }
    })
    return { payload, session: subscribed.at(-1)?.sessionId ?? null }
  }
  beforeEach(() => {
    subscribed.length = 0
    clock = TURN_END
    resetAgentHudBeacons()
    resetBeaconWatches()
    resetNativeChatKeptSessionsForTests()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })

  function leadHoldsAShellAndANestedRunWithASubagentStarts(state: State) {
    post(state, LEAD, 'SessionStart', { source: 'startup' })
    post(state, LEAD, 'UserPromptSubmit', { prompt: 'run the review script in the background' })
    post(state, LEAD, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: './review.sh', run_in_background: true }, tool_use_id: 't1' })
    post(state, LEAD, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: './review.sh' }, tool_use_id: 't1' })
    post(state, LEAD, 'Stop', {
      last_assistant_message: 'Started it.',
      background_tasks: [{ id: 'bsh1', type: 'shell', status: 'running', description: './review.sh' }],
      session_crons: []
    })
    // The script's `claude -p` hands its work to a subagent.
    expect(post(state, NESTED, 'SessionStart', { source: 'startup' }).session).toBe(LEAD)
    expect(post(state, NESTED, 'UserPromptSubmit', { prompt: 'list the risky hunks in this diff' }).session).toBe(LEAD)
    expect(post(state, NESTED, 'PreToolUse', { tool_name: 'Task', tool_input: { description: 'hunks' }, tool_use_id: 'n1' }).session).toBe(LEAD)
    expect(post(state, NESTED, 'SubagentStart', { agent_id: 'sub-1', agent_type: 'general-purpose' }).session).toBe(LEAD)
  }

  // The lead's own turn-start row claims the phone's follow-up,
  // and the nested run's subagent row that carries it after (Orca keeps the
  // prompt and the tool snapshot per pane, and the lead's prompt reset the
  // snapshot) cannot take it.
  it('the lead’s own turn-start row claims the follow-up, so the nested subagent row carrying it does not move the chat', () => {
    const state = createHookListenerState()
    leadHoldsAShellAndANestedRunWithASubagentStarts(state)
    const followUp = 'also check the migration tests'
    act(() => notePhoneTerminalSend('term-1', followUp, clock + 200))
    expect(post(state, LEAD, 'UserPromptSubmit', { prompt: followUp }).session).toBe(LEAD)
    const row = post(state, NESTED, 'PreToolUse', { agent_id: 'sub-1', agent_type: 'general-purpose', tool_name: 'Grep', tool_input: { pattern: 'x' }, tool_use_id: 's1' })
    expect(row.payload?.prompt).toBe(followUp)
    expect(row.payload?.toolName).toBeUndefined()
    expect(row.session).toBe(LEAD)
  })

  // A limit, pinned: the same when the phone never rendered the lead's
  // turn-start row (Orca coalesced it with the nested row inside its 50–250 ms
  // window, or the link was down while the lead took it). The send is
  // unclaimed, the nested subagent row has the turn-start shape (working, no
  // tool: the lead's UserPromptSubmit reset the pane's tool snapshot, and a
  // subagent's own tool event never writes it) and the phone's prompt, and it
  // claims the send. Until the next lead-level tool row on the pane.
  it('follows a nested run when the only row the phone saw carrying its follow-up is that run’s subagent row (a limit)', () => {
    const state = createHookListenerState()
    leadHoldsAShellAndANestedRunWithASubagentStarts(state)
    const followUp = 'also check the migration tests'
    act(() => notePhoneTerminalSend('term-1', followUp, clock + 200))
    feed(state, LEAD, 'UserPromptSubmit', { prompt: followUp })
    const row = post(state, NESTED, 'PreToolUse', { agent_id: 'sub-1', agent_type: 'general-purpose', tool_name: 'Grep', tool_input: { pattern: 'x' }, tool_use_id: 's1' })
    expect(row.payload?.state).toBe('working')
    expect(row.payload?.toolName).toBeUndefined()
    expect(row.session).toBe(NESTED)
  })
})
