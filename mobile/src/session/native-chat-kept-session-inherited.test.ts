// The claim the phone's /clear passes on, a same-session boundary from a live
// process, and how long a nested run keeps a phone follow-up it took: the
// fourth review of the background rule (native-chat-kept-session.ts,
// 95aa5588). Same harness as
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

const SECOND_NESTED = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a'

describe('the claim a phone /clear passes on', () => {
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

  // 1a (green): the phone-reset path marks only the new session; the M2
  // re-render (the cleared session's own boundary, now kept) keeps the mark;
  // the new session's own first turn clears it.
  it('inherits into the cleared session only, keeps it through its own boundary re-render, clears it at its first turn', () => {
    h.show(LEAD_WORKING)
    h.show(LEAD_BACKGROUND, TURN_END)
    act(() => notePhoneTerminalSend('term-1', '/clear', TURN_END + 10_000))
    expect(h.show(sessionStart(CLEARED, TURN_END + 10_500))).toBe(CLEARED)
    expect(readTurn('claude', CLEARED)).toMatchObject({ turn: 'background', inherited: true })
    expect(readTurn('claude', LEAD)?.inherited ?? false).toBe(false)
    expect(h.show(sessionStart(NESTED, TURN_END + 60_000))).toBe(CLEARED)
    h.show(turnOf(CLEARED, 'working', TURN_END + 90_000))
    expect(readTurn('claude', CLEARED)).toMatchObject({ turn: 'working', inherited: false })
  })

  // 1b (red, narrow): the mark survives a `sameClaim` repeat that is the
  // session's OWN claim when both stamps are null (a host that carries no
  // turn end on the tab, and a phone that saw none of the session's working
  // rows between): the session's own restart then keeps a claim it made.
  it('drops the inherited mark when the session makes its own claim, even with no stamp to tell the two apart', () => {
    act(() => noteTurn('claude', CLEARED, 'background', false, false, null, TURN_END, { inherited: true }))
    act(() => noteTurn('claude', CLEARED, 'background', true, false, null, TURN_END + 10 * MINUTE))
    expect(readTurn('claude', CLEARED)?.inherited ?? false).toBe(false)
  })

  // 2b (green): a desk /clear while the lead holds work still waits for the
  // new session to hold the work itself.
  it('a desk /clear while the lead holds work still waits for the new session’s own held Stop', () => {
    h.show(LEAD_WORKING)
    h.show(LEAD_BACKGROUND, TURN_END)
    expect(h.show(sessionStart(CLEARED, TURN_END + 20_000))).toBe(LEAD)
    expect(h.show(turnOf(CLEARED, 'working', TURN_END + 21_000))).toBe(LEAD)
    const held = turnOf(CLEARED, 'working', TURN_END + 40_000, { workingMode: 'monitoring', lastAssistantMessage: 'Done.' })
    expect(h.show(held, TURN_END + 40_000)).toBe(CLEARED)
  })
})

describe('same-session boundaries and a taken follow-up, through Orca’s real hook listener', () => {
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

  function leadEndsHoldingAShell(state: State) {
    post(state, LEAD, 'SessionStart', { source: 'startup' })
    post(state, LEAD, 'UserPromptSubmit', { prompt: 'run the review script in the background' })
    post(state, LEAD, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: './review.sh', run_in_background: true }, tool_use_id: 't1' })
    post(state, LEAD, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: './review.sh' }, tool_use_id: 't1' })
    post(state, LEAD, 'Stop', {
      last_assistant_message: 'Started it.',
      background_tasks: [{ id: 'bsh1', type: 'shell', status: 'running', description: './review.sh' }],
      session_crons: []
    })
  }

  // 2c (red, narrow and conditional): `/resume` of the SAME session inside the
  // live process. Orca's SessionStart handler drops the pane's inventory and
  // lands a boundary for the session; the phone reads it as the session's own
  // restart and ends the claim. If Claude kept the work (as it does through
  // /clear), the script's next `claude -p` takes the chat. 4b09c9a8 kept the
  // claim through that boundary.
  // A limit, pinned: a same-session boundary from a live process (an
  // in-process /resume of the lead itself) reads like the lead restarting
  // after an exit (`claude --resume <id>`), the likelier of the two, and ends
  // its claim; if Claude keeps the work through it, a nested run started by
  // that work is then followed. Unverified whether Claude Code 2.1.284 keeps
  // backgrounded tasks through an in-process /resume, or lets one resume the
  // current session at all.
  it('follows a nested run after an in-process /resume of the lead itself, if its background work ran on through it (a limit)', () => {
    const state = createHookListenerState()
    leadEndsHoldingAShell(state)
    const resumed = post(state, LEAD, 'SessionStart', { source: 'resume' })
    expect(resumed.payload?.sessionBoundary).toBe(true)
    expect(post(state, NESTED, 'SessionStart', { source: 'startup' }).session).toBe(NESTED)
  })

  // 2d (green, disproves a suspicion): a manual /compact of the lead is no
  // other same-session boundary here. With Orca's inventory intact it sends
  // no row for the compact; after a nested run it drops the completion
  // outright, since the pane's last row names another session
  // (canAcceptClaudeCompactCompletion).
  it('a manual /compact of the lead after a nested run lands no boundary, so the lead stays held', () => {
    const state = createHookListenerState()
    leadEndsHoldingAShell(state)
    expect(post(state, LEAD, 'PostCompact', { trigger: 'manual', prompt_id: '11111111-1111-4111-8111-111111111111' }).payload).toBeNull()
    expect(post(state, NESTED, 'SessionStart', { source: 'startup' }).session).toBe(LEAD)
    expect(post(state, NESTED, 'UserPromptSubmit', { prompt: 'list the risky hunks' }).session).toBe(LEAD)
    expect(post(state, NESTED, 'Stop', { last_assistant_message: 'Two.', background_tasks: [], session_crons: [] }).session).toBe(LEAD)
    expect(post(state, LEAD, 'PostCompact', { trigger: 'manual', prompt_id: '22222222-2222-4222-8222-222222222222' }).payload).toBeNull()
    expect(post(state, SECOND_NESTED, 'SessionStart', { source: 'startup' }).session).toBe(LEAD)
  })

  // 3b (red): the pinned limit's reach. When the lead answers the follow-up
  // with no tool (a text-only reply), its next row is its Stop, which Orca
  // holds `working` (the nested run's subagent is on the pane's roster) and
  // stamps: the phone notes `background`, not a second turn, so nothing
  // brings the chat back while the nested run lasts. The lead's reply to the
  // phone's own follow-up is off the screen: the original symptom.
  // A limit, pinned: when the lead answers the follow-up a nested subagent
  // row took WITHOUT a tool, its next row is its Stop, which Orca holds
  // `working` for the nested run's subagent on the pane's roster and stamps:
  // a claim, not a second turn. The chat stays on the nested run until that
  // run ends and the lead posts again.
  it('stays on the nested run when the lead answers the phone’s follow-up without a tool, after a nested subagent row took it (a limit)', () => {
    const state = createHookListenerState()
    leadEndsHoldingAShell(state)
    expect(post(state, NESTED, 'SessionStart', { source: 'startup' }).session).toBe(LEAD)
    expect(post(state, NESTED, 'UserPromptSubmit', { prompt: 'list the risky hunks in this diff' }).session).toBe(LEAD)
    expect(post(state, NESTED, 'PreToolUse', { tool_name: 'Task', tool_input: { description: 'hunks' }, tool_use_id: 'n1' }).session).toBe(LEAD)
    expect(post(state, NESTED, 'SubagentStart', { agent_id: 'sub-1', agent_type: 'general-purpose' }).session).toBe(LEAD)
    const followUp = 'what did the review find so far?'
    act(() => notePhoneTerminalSend('term-1', followUp, clock + 200))
    feed(state, LEAD, 'UserPromptSubmit', { prompt: followUp })
    expect(post(state, NESTED, 'PreToolUse', { agent_id: 'sub-1', agent_type: 'general-purpose', tool_name: 'Grep', tool_input: { pattern: 'x' }, tool_use_id: 's1' }).session).toBe(NESTED)
    const leadStop = post(state, LEAD, 'Stop', {
      last_assistant_message: 'So far: two risky hunks.',
      background_tasks: [{ id: 'bsh1', type: 'shell', status: 'running', description: './review.sh' }],
      session_crons: []
    })
    expect(leadStop.payload?.state).toBe('working')
    expect(leadStop.session).toBe(NESTED)
  })

  // 3 (green, disproves a suspicion): when the lead answers with a tool, its
  // first tool row is a second turn of the lead's (it finished the turn that
  // started the work), and the chat comes back there.
  it('comes back to the lead at its next tool row after a nested subagent row took the phone’s follow-up', () => {
    const state = createHookListenerState()
    leadEndsHoldingAShell(state)
    expect(post(state, NESTED, 'SessionStart', { source: 'startup' }).session).toBe(LEAD)
    expect(post(state, NESTED, 'UserPromptSubmit', { prompt: 'list the risky hunks in this diff' }).session).toBe(LEAD)
    expect(post(state, NESTED, 'PreToolUse', { tool_name: 'Task', tool_input: { description: 'hunks' }, tool_use_id: 'n1' }).session).toBe(LEAD)
    expect(post(state, NESTED, 'SubagentStart', { agent_id: 'sub-1', agent_type: 'general-purpose' }).session).toBe(LEAD)
    const followUp = 'also check the migration tests'
    act(() => notePhoneTerminalSend('term-1', followUp, clock + 200))
    feed(state, LEAD, 'UserPromptSubmit', { prompt: followUp })
    expect(post(state, NESTED, 'PreToolUse', { agent_id: 'sub-1', agent_type: 'general-purpose', tool_name: 'Grep', tool_input: { pattern: 'x' }, tool_use_id: 's1' }).session).toBe(NESTED)
    // The lead answers the follow-up: its first tool row, the "next lead-level tool row".
    const leadTool = post(state, LEAD, 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/tmp/migrations.test.ts' }, tool_use_id: 'l2' })
    expect(leadTool.payload?.toolName).toBe('Read')
    expect(leadTool.session).toBe(LEAD)
  })
})

