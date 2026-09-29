// Where the chat's session rule for a nested agent after a turn with
// background work (native-chat-kept-session.ts) could still be led astray,
// found by the second review of that rule (342ef7cd) and pinned here: a link
// blip, a revisit or a cold start in between; the phone's own sends read too
// eagerly; a photo send; an unstamped claim. Same harness as
// native-chat-nested-claude-after-turn.test.ts; the last case feeds Orca's
// real vendored hook listener, so the prompt each row carries is Orca's own.
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
import { useMobileNativeChatController } from './use-mobile-native-chat-controller'

type Status = Record<string, unknown>
type Conn = 'connected' | 'disconnected'

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
const LEAD_BACKGROUND: Status = {
  ...LEAD_WORKING,
  workingMode: 'monitoring',
  toolName: undefined,
  lastAssistantMessage: 'The dev server is running in the background.',
  updatedAt: TURN_END
}
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

describe('the lead’s background claim through gaps in the watch, and the phone’s own sends', () => {
  let renderer: ReactTestRenderer | null = null
  const clientStub = { sendRequest: vi.fn(), getState: () => 'connected' as const, notifyForeground: vi.fn() }

  function Chat({ tab, tabsLive, connState }: { tab: Status; tabsLive: boolean; connState: Conn }): null {
    useMobileNativeChatController({
      client: clientStub as unknown as RpcClient,
      connState,
      tabsLive,
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
  function show(
    status: Status,
    turnCompletedAt?: number,
    { tabsLive = true, connState = 'connected' }: { tabsLive?: boolean; connState?: Conn } = {}
  ): string | null {
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
      const element = createElement(Chat, { tab, tabsLive, connState })
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
      }
    })
    return subscribed.at(-1)?.sessionId ?? null
  }
  const nestedRun = (from: number) => {
    expect(show(sessionStart(NESTED, from))).toBe(LEAD)
    expect(show(turnOf(NESTED, 'working', from + 1_000, { toolName: 'Read' }))).toBe(LEAD)
  }

  beforeEach(() => {
    subscribed.length = 0
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

  // 342ef7cd wrote a `background` verdict seen while not watching as
  // `ended`, with the tab's stamp. When watching comes back with the same
  // stand-in, the guard takes that `ended` for the all-clear of this very turn
  // (same stamp) and skips the `background`. One link blip while the lead
  // idles holding background work undoes the 9c615a2a fix until its next row.
  it('stays on the lead through a link blip while its background work runs', () => {
    show(LEAD_WORKING)
    show(LEAD_STAND_IN, TURN_END)
    show(LEAD_STAND_IN, TURN_END, { connState: 'disconnected' })
    show(LEAD_STAND_IN, TURN_END)
    nestedRun(TURN_END + 5 * MINUTE)
  })

  // The same through a revisit of the project: the screen paints the
  // cached tab list first (terminalsLoaded false), then the host's own.
  it('stays on the lead after the project is left and opened again while its background work runs', () => {
    show(LEAD_WORKING)
    show(LEAD_STAND_IN, TURN_END)
    show(LEAD_STAND_IN, TURN_END, { tabsLive: false })
    show(LEAD_STAND_IN, TURN_END)
    nestedRun(TURN_END + 5 * MINUTE)
  })

  // A revisit whose first live status is already the nested run (it
  // started while the phone showed another project).
  it('stays on the lead when the nested run started while the project was left', () => {
    show(LEAD_WORKING)
    show(LEAD_STAND_IN, TURN_END)
    show(LEAD_STAND_IN, TURN_END, { tabsLive: false })
    nestedRun(TURN_END + 5 * MINUTE)
  })

  // And after a cold start whose cached list held that stand-in: the
  // host's own list then shows the same stand-in, which should hold the lead.
  it('holds the lead after a cold start once the host’s own list shows the turn still held by background work', () => {
    show(LEAD_STAND_IN, TURN_END, { tabsLive: false })
    show(LEAD_STAND_IN, TURN_END)
    nestedRun(TURN_END + 5 * MINUTE)
  })

  // 342ef7cd's phone-reset took ANY session boundary within 2 minutes of the phone's
  // /clear, not the first one: a nested run started by the lead's background
  // work in that window takes the chat from the session the /clear made.
  it('stays on the session the phone’s /clear started when a nested run starts inside the 2 minutes', () => {
    show(LEAD_WORKING)
    show(LEAD_BACKGROUND, TURN_END)
    act(() => notePhoneTerminalSend('term-1', '/clear', TURN_END + 10_000))
    expect(show(sessionStart(CLEARED, TURN_END + 10_500))).toBe(CLEARED)
    // The script the lead's background shell runs starts `claude -p`.
    expect(show(sessionStart(NESTED, TURN_END + 60_000))).toBe(CLEARED)
  })

  // The same window while the lead is mid-turn: the /clear waits in
  // Claude's queue, and a nested claude -p the lead's Bash tool starts lands
  // its SessionStart first.
  it('stays on the lead mid-turn when a nested run starts within 2 minutes of a /clear the phone queued', () => {
    show(LEAD_WORKING)
    act(() => notePhoneTerminalSend('term-1', '/clear', TURN_END))
    expect(show(sessionStart(NESTED, TURN_END + 30_000))).toBe(LEAD)
  })

  // A photo send records its caption; the hook's
  // copy of it leads with Claude's `[Image #N]` markers
  // (mobile-chat-phone-photo-hook-copy.test.ts), so phone-prompt never matches.
  it('follows a restarted claude that takes a photo with a caption this phone sent', () => {
    show(LEAD_WORKING)
    show(LEAD_BACKGROUND, TURN_END)
    show({ ...LEAD_STAND_IN, updatedAt: TURN_END + 5_000 }, TURN_END)
    show(sessionStart(CLEARED, TURN_END + 20_000))
    act(() => notePhoneTerminalSend('term-1', 'what is wrong in this screenshot', TURN_END + 20_500))
    expect(show(turnOf(CLEARED, 'working', TURN_END + 21_000, { prompt: '[Image #1] what is wrong in this screenshot' }))).toBe(CLEARED)
  })

  // A `background` noted with no stamp (a monitoring hook row on a
  // tab without turnCompletedAt) never expires: BACKGROUND_CLAIM_MS needs one.
  it('leaves a lead whose unstamped background claim is over 30 minutes old', () => {
    show(LEAD_WORKING)
    show(LEAD_BACKGROUND)
    expect(show(turnOf(CLEARED, 'working', TURN_END + 40 * MINUTE))).toBe(CLEARED)
  })
})

describe('the phone’s prompt through Orca’s per-pane prompt cache', () => {
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
  function post(state: ReturnType<typeof createHookListenerState>, session: string, hook: string, extra: Status = {}) {
    const payload = normalizeAndAccept(state, 'claude', {
      hook_event_name: hook,
      session_id: session,
      transcript_path: claudeSession(session).transcriptPath,
      cwd: '/tmp',
      ...extra
    })?.payload as Status | undefined
    if (!payload) {
      return { payload: null, session: subscribed.at(-1)?.sessionId ?? null }
    }
    clock += 1000
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

  // Orca caches the prompt per PANE (resolvePrompt, lastPromptByPaneKey),
  // not per session. The lead's background script runs `claude -p`; the user
  // sends a follow-up from the phone, the lead takes it, and the nested run's
  // next tool row carries the lead's (the phone's) prompt: phone-prompt moves
  // the chat to the nested session, while the lead answers the phone.
  it('stays on the lead when a nested run’s row carries the phone’s prompt through Orca’s per-pane prompt cache', () => {
    const state = createHookListenerState()
    post(state, LEAD, 'SessionStart', { source: 'startup' })
    post(state, LEAD, 'UserPromptSubmit', { prompt: 'run the review script in the background' })
    post(state, LEAD, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: './review.sh', run_in_background: true }, tool_use_id: 't1' })
    post(state, LEAD, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: './review.sh' }, tool_use_id: 't1' })
    post(state, LEAD, 'Stop', {
      last_assistant_message: 'Started it.',
      background_tasks: [{ id: 'bsh1', type: 'shell', status: 'running', description: './review.sh' }],
      session_crons: []
    })
    expect(post(state, NESTED, 'SessionStart', { source: 'startup' }).session).toBe(LEAD)
    expect(post(state, NESTED, 'UserPromptSubmit', { prompt: 'list the risky hunks in this diff' }).session).toBe(LEAD)
    expect(post(state, NESTED, 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/tmp/a.diff' }, tool_use_id: 'n1' }).session).toBe(LEAD)
    const followUp = 'also check the migration tests'
    act(() => notePhoneTerminalSend('term-1', followUp, clock + 200))
    expect(post(state, LEAD, 'UserPromptSubmit', { prompt: followUp }).session).toBe(LEAD)
    const nestedRow = post(state, NESTED, 'PreToolUse', { tool_name: 'Grep', tool_input: { pattern: 'TODO' }, tool_use_id: 'n2' })
    expect(nestedRow.payload?.prompt).toBe(followUp)
    expect(nestedRow.session).toBe(LEAD)
    expect(subscribed.map((entry) => entry.sessionId)).not.toContain(NESTED)
  })
})
