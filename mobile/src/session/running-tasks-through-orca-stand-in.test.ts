// Reported from the phone on 2026-09-29 with two screenshots: "there are
// background processes running but the chat UI doesn't show that": no
// "N running tasks" on the status line, nothing running in the tasks sheet.
//
// Orca 1.4.216 sends the phone a status built from the terminal title in place
// of the pane's hook row whenever the title changed after that row and the two
// disagree (`renewMobileAgentStatusFromPtyTitle`; `SEa` in the 1.4.216
// app.asar). When a Claude turn's Stop row reaches Orca before the title turns
// idle, the phone is sent a `done` with no roster in place of the row that
// said the pane was `working` on background work. Over a long
// tool call the same stand-in, `working`, replaces a row gone stale. See
// agent-status-stand-in.ts.
//
// The chat is mounted as the app mounts it (the real controller); what the
// status line and the sheet would draw is the task reader run over what the
// controller hands the chat view, as MobileNativeChatTasksProvider runs it.
// The launches are Claude Code 2.1.281's own records
// (fixtures/claude-orchestration-2.1.281.ts); the statuses follow the shapes
// Orca 1.4.216 builds: its store's hook row, and the stand-in, whose every
// field is listed in agent-status-stand-in.ts.
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry, AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'

vi.mock('./use-mobile-session-view-mode', () => ({
  useMobileSessionViewMode: () => ({ isTabChatView: () => true, toggleTabChatView: vi.fn() })
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => null
}))
const session = vi.hoisted(() => ({ messages: [] as unknown[] }))
vi.mock('./use-mobile-native-chat-session', () => ({
  useMobileNativeChatSession: () => ({ messages: session.messages, status: 'ready', transcriptLoading: false })
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

import { backgroundShellLaunch, OWN_AGENTS, ownAgentLaunch, rosterRow } from './fixtures/claude-orchestration-2.1.281'
import { consumeAgentHudBeacons, resetAgentHudBeacons } from './agent-hud-beacon'
import { deriveReportedBackgroundTasks } from './mobile-reported-background-tasks'
import { resetNativeChatKeptSessionsForTests } from './native-chat-kept-session-store'
import { resetTaskEvidenceForTests } from './use-active-tab-task-report'
import { useMobileNativeChatController, type MobileNativeChatController } from './use-mobile-native-chat-controller'
import { formatBackgroundTaskElapsed } from './mobile-background-task-labels'
import type { SubagentRunClock } from './mobile-subagent-runs'
import { resetSubagentRunClocksForTest, useSubagentRunClock } from './use-subagent-run-clock'

type Agent = 'claude' | 'codex'
const at = (clock: string) => Date.parse(`2026-09-29T${clock}Z`)
const SESSION: Record<Agent, { id: string; transcriptPath: string }> = {
  claude: {
    id: '5f2d8c61-3b0e-4f7a-9c44-2e61d0a9b7c3',
    transcriptPath: '/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Code-UI/5f2d8c61-3b0e-4f7a-9c44-2e61d0a9b7c3.jsonl'
  },
  codex: {
    id: '019a6c1e-7d42-7b30-a8f1-5c9e2d4b1a07',
    transcriptPath: '/Users/alwinpaul/.codex/sessions/2026/09/29/rollout-2026-09-29T09-58-02-019a6c1e-7d42-7b30-a8f1-5c9e2d4b1a07.jsonl'
  }
}

/** A phone-launched Claude's status-line beacon, declaring a 5 s beat. */
const BEACON = `\u001b]7777;CUIHUD1 agent=claude sid=${SESSION.claude.id} hb=5\u0007`

/** The pane's hook row as Orca's store holds it after the lead's Stop, with
 *  background work still running: Orca keeps the pane `working` (in
 *  `monitoring` mode when only shells run), so the working state still dates
 *  from the prompt that opened the turn. */
function hookRow(agent: Agent, tab: string, fields: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    state: 'working',
    prompt: 'Start the dev server and the reviewers in the background',
    updatedAt: at('10:00:05.000'),
    stateStartedAt: at('09:59:30.000'),
    paneKey: `${tab}:leaf-1`,
    agentType: agent,
    tabId: tab,
    terminalTitle: agent === 'claude' ? '✳ Dev server' : 'codex',
    stateHistory: [{ state: 'done', prompt: 'the prompt before', startedAt: at('09:58:00.000') }],
    lastAssistantMessage: 'Both are running in the background.',
    providerSession: { key: 'session_id', ...SESSION[agent] },
    ...fields
  } as AgentStatusEntry
}

/** Orca's stand-in for that row, once the title changed after it: the
 *  title's state, and the row's identity fields copied, nothing else. */
function standIn(agent: Agent, tab: string, state: 'done' | 'working', clock = '10:00:05.300'): AgentStatusEntry {
  return {
    state,
    prompt: '',
    updatedAt: at(clock),
    stateStartedAt: at(clock),
    paneKey: `${tab}:leaf-1`,
    stateHistory: [],
    agentType: agent,
    tabId: tab,
    terminalTitle: agent === 'claude' ? '✳ Dev server' : 'codex',
    providerSession: { key: 'session_id', ...SESSION[agent] }
  } as AgentStatusEntry
}

/** What Orca sends once the agent has left the pane (a shell title): `done`,
 *  and none of the fields the title stand-in copies. */
function leftPane(agent: Agent, tab: string): AgentStatusEntry {
  return {
    state: 'done',
    prompt: '',
    updatedAt: at('10:05:00.000'),
    stateStartedAt: at('10:05:00.000'),
    paneKey: `${tab}:leaf-1`,
    stateHistory: [],
    agentType: agent,
    providerSession: { key: 'session_id', ...SESSION[agent] }
  } as AgentStatusEntry
}

const SHELL = 'bbgtz4rfz'
const AGENT = OWN_AGENTS.abe6.id
/** Claude: the lead started a dev server in the background and an agent,
 *  then answered. */
const CLAUDE_TURN: NativeChatMessage[] = [
  ...backgroundShellLaunch(SHELL, '2026-09-29T09:59:40.000Z', '2026-09-29T09:59:41.000Z'),
  ...ownAgentLaunch({ id: AGENT, call: '2026-09-29T09:59:50.000Z', result: '2026-09-29T09:59:52.000Z' }),
  {
    id: 'reply',
    role: 'assistant',
    timestamp: at('10:00:04.500'),
    source: 'transcript',
    blocks: [{ type: 'text', text: 'Both are running in the background.' }]
  }
]
const roster = (...rows: AgentSubagentSnapshot[]) => ({ subagents: rows })
/** Orca's hook listener stamps `turnCompletedAt` on the row that holds the pane
 *  `working` after the lead's Stop because background work is still
 *  registered (vendored claude-events.ts), and Orca 1.4.216 carries it on the
 *  TAB from the live hook row, past its own title stand-in, for as long as
 *  that row is under 30 minutes old. */
const GATED = { turnCompletedAt: at('10:00:05.000') }
const AGENT_ROW = rosterRow(AGENT, at('09:59:51.000'))
const REVIEWER_ROW = rosterRow('a77d87fe2e3c0195d', at('09:59:55.000'))

describe('background work the chat shows while Orca stands in the pane status', () => {
  let renderer: ReactTestRenderer | null = null
  let controller: MobileNativeChatController | null = null
  let runs: SubagentRunClock | undefined
  const clientStub = { sendRequest: vi.fn(), getState: () => 'connected' as const, notifyForeground: vi.fn() }

  function Chat({ agent, tab, status, connState, tabsLive, turnCompletedAt }: { agent: Agent; tab: string; status: AgentStatusEntry; connState: ConnectionState; tabsLive: boolean; turnCompletedAt?: number }): null {
    controller = useMobileNativeChatController({
      client: clientStub as unknown as RpcClient,
      connState,
      tabsLive,
      hostId: 'h',
      worktreeId: 'w',
      activeSessionTab: { type: 'terminal', id: tab, terminal: `term-${tab}`, launchAgent: agent, agentStatus: status, isActive: true, ...(turnCompletedAt === undefined ? {} : { turnCompletedAt }) } as never,
      activeSessionTabId: tab,
      activeHandle: `term-${tab}`,
      activeHandleRef: { current: `term-${tab}` },
      deviceTokenRef: { current: null },
      nativeChatTranscriptIsLocalReadable: true,
      nativeChatInputLeaseReady: true,
      onSendError: vi.fn(),
      onSendResolved: vi.fn()
    })
    // The run clock, observed off what the chat view is handed, as the
    // running-task count and the sheet observe it (use-subagent-run-clock.ts).
    runs = useSubagentRunClock(controller.nativeChatAgentStatus)
    return null
  }

  /** The running tasks the status line and the sheet draw for this status:
   *  the reader MobileNativeChatTasksProvider runs, over the view's props. */
  function show(
    agent: Agent,
    status: AgentStatusEntry,
    {
      tab = 'tab-1',
      connState = 'connected',
      tabsLive = true,
      turnCompletedAt
    }: { tab?: string; connState?: ConnectionState; tabsLive?: boolean; turnCompletedAt?: number } = {}
  ): string[] {
    act(() => {
      const element = createElement(Chat, { agent, tab, status, connState, tabsLive, ...(turnCompletedAt === undefined ? {} : { turnCompletedAt }) })
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
      }
    })
    const chat = controller!
    return deriveReportedBackgroundTasks(
      session.messages as NativeChatMessage[],
      at('10:01:00.000'),
      chat.nativeChatAgentStatus,
      chat.nativeChatBackgroundTaskReport
    ).running.map((task) => task.id)
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(at('10:00:06.000'))
    resetAgentHudBeacons()
    resetTaskEvidenceForTests()
    resetNativeChatKeptSessionsForTests()
    resetSubagentRunClocksForTest()
    runs = undefined
    session.messages = []
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    controller = null
    runs = undefined
    vi.useRealTimers()
  })

  // The report. The lead answered with a dev server and an agent still
  // running; the title turned idle after its Stop.
  it('keeps a Claude turn’s background shell and agent running when Orca stands in a done status after the turn', () => {
    session.messages = CLAUDE_TURN
    expect(show('claude', hookRow('claude', 'tab-1', roster(AGENT_ROW)), GATED)).toEqual([SHELL, AGENT])
    expect(show('claude', standIn('claude', 'tab-1', 'done'), GATED)).toEqual([SHELL, AGENT])
    // And through the next one, a second after.
    expect(show('claude', standIn('claude', 'tab-1', 'done', '10:00:06.300'), GATED)).toEqual([SHELL, AGENT])
  })

  // Orca coalesces the phone's tab snapshots (50 ms, at most 250 ms) and
  // builds each from its state at the flush, and every spinner frame restamps
  // the title, so the phone often never sees the Stop row: the last row it
  // saw is the turn's last TOOL row, the lead working (the review of
  // 09aa69a0). Only Orca's turn end on the tab says background work outlived
  // the turn.
  it('keeps the background work when the phone saw only the turn’s last tool row, while the tab carries Orca’s turn end', () => {
    session.messages = CLAUDE_TURN
    const toolRow = { workingMode: undefined, toolName: 'Bash', lastAssistantMessage: undefined, ...roster(AGENT_ROW), updatedAt: at('10:00:03.000') }
    show('claude', hookRow('claude', 'tab-1', toolRow))
    show('claude', standIn('claude', 'tab-1', 'working', '10:00:04.900'), GATED)
    expect(show('claude', standIn('claude', 'tab-1', 'done'), GATED)).toEqual([SHELL, AGENT])
    // Only the task readers read that row: the Working row and Stop read the
    // stand-in, whose idle title says the lead is done. Read off the held row
    // (the lead working, no reply reported) they would draw Working again.
    expect(controller?.nativeChatAgentWorking).toBe(false)
    expect(controller?.nativeChatCanStop).toBe(false)
  })

  // A shell that finished mid-turn: its notification is a queued_command
  // attachment Orca's reader drops, and a hand-started tab has no beacon. The
  // Stop that followed held nothing (no turn end on the tab), so the pane is
  // done and the shell with it (the review of 09aa69a0).
  it('retires a shell that finished mid-turn once the turn ends with nothing left running, when the phone saw only the last tool row', () => {
    session.messages = [...CLAUDE_TURN.slice(0, 2), CLAUDE_TURN[4]!]
    show('claude', hookRow('claude', 'tab-1', { workingMode: undefined, toolName: 'Read', updatedAt: at('10:00:03.000') }))
    show('claude', standIn('claude', 'tab-1', 'working', '10:00:04.900'))
    expect(show('claude', standIn('claude', 'tab-1', 'done'))).toEqual([])
  })

  // The case already known: a long tool call, the row gone stale.
  it.each(['claude', 'codex'] as const)('keeps the roster’s agents running through a working stand-in over a long tool call (%s)', (agent) => {
    session.messages = agent === 'claude' ? CLAUDE_TURN.slice(2, 4) : []
    const rows = agent === 'claude' ? roster(AGENT_ROW) : roster(AGENT_ROW, REVIEWER_ROW)
    const expected = agent === 'claude' ? [AGENT] : [AGENT, REVIEWER_ROW.id]
    expect(show(agent, hookRow(agent, 'tab-1', { workingMode: undefined, ...rows }))).toEqual(expected)
    expect(show(agent, standIn(agent, 'tab-1', 'working'))).toEqual(expected)
  })

  // A limit, pinned: Orca's hook listener stamps the turn end for Claude only
  // (claude-events.ts), so nothing says a Codex sub-agent outlived the lead's
  // turn, and a done stand-in on a Codex tab is read as it comes.
  it('reads a Codex tab’s done stand-in as it comes: Orca stamps no turn end for Codex (a limit)', () => {
    const rows = roster(AGENT_ROW)
    expect(show('codex', hookRow('codex', 'tab-1', rows))).toEqual([AGENT])
    expect(show('codex', standIn('codex', 'tab-1', 'done'))).toEqual([])
  })

  // A hook row after the stand-in is the host's word again.
  it('drops an agent the next hook row no longer lists, after a stand-in', () => {
    session.messages = CLAUDE_TURN
    show('claude', hookRow('claude', 'tab-1', roster(AGENT_ROW)))
    show('claude', standIn('claude', 'tab-1', 'done'))
    expect(show('claude', hookRow('claude', 'tab-1', { updatedAt: at('10:00:30.000') }))).toEqual([SHELL])
  })

  // Why the hold needs the phone to have watched the pane since the row
  // (the review of b860f0d1, fix/midturn-residuals): a subagent that finished
  // while the chat showed another tab must not come back through a stand-in.
  it('does not bring back an agent that finished while the chat showed another tab', () => {
    show('codex', hookRow('codex', 'tab-1', roster(AGENT_ROW, REVIEWER_ROW)))
    show('codex', hookRow('codex', 'tab-2'))
    expect(show('codex', standIn('codex', 'tab-1', 'working'))).toEqual([])
  })

  it.each([
    ['the link dropped', { connState: 'disconnected' as const }],
    ['the tab list is the one the last visit cached', { tabsLive: false }]
  ])('reads the stand-in as it comes after %s', (_label, gap) => {
    session.messages = CLAUDE_TURN
    show('claude', hookRow('claude', 'tab-1', roster(AGENT_ROW)), GATED)
    show('claude', hookRow('claude', 'tab-1', roster(AGENT_ROW)), { ...gap, ...GATED })
    expect(show('claude', standIn('claude', 'tab-1', 'done'), GATED)).toEqual([])
  })

  // Orca's headless builder, and its PTY builder when the renderer published
  // none, send hook rows with no prompt and no history: there a real row that
  // tracks no subagent has the stand-in's shape (the same review).
  it('drops a finished agent when a hook row with no prompt and no history says none is tracked', () => {
    const bare = { prompt: '', stateHistory: [] }
    show('codex', hookRow('codex', 'tab-1', { ...bare, ...roster(AGENT_ROW) }))
    expect(show('codex', { ...standIn('codex', 'tab-1', 'working'), updatedAt: at('10:00:20.000') })).toEqual([])
  })

  // An agent that exits takes its shells with it, and Orca then sends a done
  // that copies none of the title stand-in's identity fields.
  it('retires the shells when the agent has left the pane', () => {
    session.messages = CLAUDE_TURN
    show('claude', hookRow('claude', 'tab-1', roster(AGENT_ROW)), GATED)
    expect(show('claude', leftPane('claude', 'tab-1'), GATED)).toEqual([])
  })

  // With no renderer row for the pane, Orca's last resort for it is a `done`
  // with every identity field (`buildPtyMobileAgentStatus`, SQa in the
  // 1.4.216 asar: "what retires the card once the agent exits"), the title
  // stand-in's exact shape (the review of 09aa69a0).
  it('retires the shell and agent Claude killed on exit, when the turn before held nothing', () => {
    session.messages = CLAUDE_TURN
    show('claude', hookRow('claude', 'tab-1', { workingMode: undefined, ...roster(AGENT_ROW) }))
    expect(show('claude', standIn('claude', 'tab-1', 'done', '10:05:00.000'))).toEqual([])
  })

  // A silent beacon is no sign the agent left (the re-review of 8c71e9fd,
  // which dropped that rule). Claude unmounts its status line, and the beat
  // with it, under every picker and dialog: an idle lead with /tasks open on
  // the desk beats no more than one that exited (agent-hud-beacon-liveness.ts).
  it('keeps the background work while the idle lead sits under a desktop dialog that silenced its beacon', () => {
    session.messages = CLAUDE_TURN
    act(() => {
      consumeAgentHudBeacons('term-tab-1', BEACON)
    })
    expect(show('claude', hookRow('claude', 'tab-1', roster(AGENT_ROW)), GATED)).toEqual([SHELL, AGENT])
    expect(show('claude', standIn('claude', 'tab-1', 'done'), GATED)).toEqual([SHELL, AGENT])
    vi.setSystemTime(at('10:00:45.000'))
    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(show('claude', standIn('claude', 'tab-1', 'done'), GATED)).toEqual([SHELL, AGENT])
  })

  // The beacon store is keyed by terminal handle and outlives the process: a
  // phone-launched Claude left its beacon, then `claude -c` typed into the
  // same terminal (same session id, no beacon flag) never beats.
  it('keeps a hand-started successor’s background work in a terminal whose last beacon was a previous process’s', () => {
    vi.setSystemTime(at('09:50:00.000'))
    act(() => {
      consumeAgentHudBeacons('term-tab-1', BEACON)
    })
    vi.setSystemTime(at('10:00:06.000'))
    session.messages = CLAUDE_TURN
    expect(show('claude', hookRow('claude', 'tab-1', roster(AGENT_ROW)), GATED)).toEqual([SHELL, AGENT])
    expect(show('claude', standIn('claude', 'tab-1', 'done'), GATED)).toEqual([SHELL, AGENT])
  })

  // After a reconnect the watch is empty and the first stand-in is read as it
  // comes. The task memory read its missing roster as none: a row from before
  // the loaded window lost the benefit of the doubt, and the next hook row
  // listing it showed a reviewer's row, hidden until it stopped.
  it('shows an agent from before the loaded window again when the next hook row lists it, after a reconnect read a stand-in first', () => {
    session.messages = CLAUDE_TURN.slice(0, 2)
    const earlier = rosterRow(OWN_AGENTS.a441.id, at('09:40:00.000'))
    expect(show('claude', hookRow('claude', 'tab-1', roster(earlier)), GATED)).toEqual([SHELL, earlier.id])
    show('claude', hookRow('claude', 'tab-1', roster(earlier)), { connState: 'disconnected', ...GATED })
    show('claude', standIn('claude', 'tab-1', 'done'), GATED)
    expect(show('claude', hookRow('claude', 'tab-1', { ...roster(earlier), updatedAt: at('10:00:40.000') }), GATED)).toEqual([SHELL, earlier.id])
  })

  // The other side of the case above (the third review pass). A row that
  // stopped while the phone was away and came back had a new run: Orca drops
  // a stopped subagent's row and starts it afresh, so its start moved. Without
  // the lead's SendMessage in the transcript, its parent subagent resumed it:
  // a reviewer's, not the session's own.
  it('does not count a reviewer its parent resumed after it stopped unseen, once the phone came back to a stand-in', () => {
    session.messages = CLAUDE_TURN.slice(0, 2)
    const reviewer = 'a77d87fe2e3c0195d'
    expect(show('claude', hookRow('claude', 'tab-1', roster(rosterRow(reviewer, at('09:40:00.000')))))).toEqual([SHELL, reviewer])
    show('claude', hookRow('claude', 'tab-1', roster(rosterRow(reviewer, at('09:40:00.000')))), { connState: 'disconnected' })
    expect(show('claude', standIn('claude', 'tab-1', 'done', '10:00:20.000'))).toEqual([])
    vi.setSystemTime(at('10:00:41.000'))
    const resumed = hookRow('claude', 'tab-1', { ...roster(rosterRow(reviewer, at('10:00:30.000'))), updatedAt: at('10:00:40.000') })
    expect(show('claude', resumed)).toEqual([SHELL])
  })

  // But a new start alone is no stop. A `claude -p` the lead runs from its
  // Bash tool posts as the pane: its SessionStart, and its events naming
  // another session, make Orca delete the pane's roster rows and re-create
  // the lead's running agents with new starts (vendored claude-events.ts),
  // while the phone withholds the nested run's statuses from the task
  // readers (the fourth review pass). Only a start that moved across a
  // stand-in, where the roster went unseen, ends the doubt.
  it('keeps counting the lead’s own agent from before the loaded window after a nested claude in the pane made Orca re-create its row', () => {
    session.messages = CLAUDE_TURN.slice(0, 2)
    const earlier = OWN_AGENTS.a441.id
    expect(show('claude', hookRow('claude', 'tab-1', roster(rosterRow(earlier, at('09:40:00.000')))))).toEqual([SHELL, earlier])
    vi.setSystemTime(at('10:00:41.000'))
    const recreated = hookRow('claude', 'tab-1', { ...roster(rosterRow(earlier, at('10:00:30.000'))), updatedAt: at('10:00:40.000') })
    expect(show('claude', recreated)).toEqual([SHELL, earlier])
  })
  /** How long the sheet says an agent has run at `clock`, off the run clock
   *  the chat view's readers keep. */
  function runTime(id: string, clock: string): string | null {
    const task = deriveReportedBackgroundTasks([], at(clock), controller!.nativeChatAgentStatus, controller!.nativeChatBackgroundTaskReport, runs).running.find(
      (running) => running.id === id
    )
    return task ? formatBackgroundTaskElapsed(task.elapsedMs ?? null) : null
  }

  // The cross-branch review of fix/midturn-residuals and ad2253 (2026-09-29):
  // the run clock restarted on any later start (2f526916), and the nested
  // claude above moves the start with no stop. The count kept the agent and
  // the sheet timed it from the re-creation: "30s" beside the desk's "1h 15m".
  // While the nested claude runs: the lead's row after it lists none
  // (use-subagent-run-clock.test.ts, the limit).
  it('keeps timing the lead’s agent from the start the phone watched while a nested claude in the pane has re-created its row', () => {
    vi.setSystemTime(at('08:45:02.000'))
    show('claude', hookRow('claude', 'tab-1', { ...roster(rosterRow(AGENT, at('08:45:00.000'))), updatedAt: at('08:45:01.000') }))
    vi.setSystemTime(at('10:00:00.000'))
    show('claude', hookRow('claude', 'tab-1', { ...roster(rosterRow(AGENT, at('09:59:30.000'))), updatedAt: at('09:59:30.000') }))
    expect(runTime(AGENT, '10:00:00.000')).toBe('1h 15m')
  })

  // The run a stand-in hides: read through while the phone watches, the clock
  // goes on; a stand-in read as it comes (the watch broken by a link drop)
  // says nothing of the roster, and the clock keeps the run through it too.
  it('keeps timing an agent through a stand-in, read through or as it comes', () => {
    vi.setSystemTime(at('08:45:02.000'))
    const row = hookRow('claude', 'tab-1', { ...roster(rosterRow(AGENT, at('08:45:00.000'))), updatedAt: at('08:45:01.000') })
    show('claude', row)
    vi.setSystemTime(at('09:30:00.000'))
    show('claude', standIn('claude', 'tab-1', 'working', '09:30:00.000'))
    expect(controller?.nativeChatAgentStatus).toBe(row)
    expect(runTime(AGENT, '09:30:00.000')).toBe('45m 0s')
    show('claude', row, { connState: 'disconnected' })
    vi.setSystemTime(at('10:00:00.000'))
    show('claude', standIn('claude', 'tab-1', 'working', '10:00:00.000'))
    expect(controller?.nativeChatAgentStatus?.subagents).toBeUndefined()
    show('claude', hookRow('claude', 'tab-1', { ...roster(rosterRow(AGENT, at('08:45:00.000'))), updatedAt: at('10:00:00.000') }))
    expect(runTime(AGENT, '10:00:00.000')).toBe('1h 15m')
  })

  // 2f526916's case, on this path: the lead resumed the agent by SendMessage
  // while a stand-in read as it comes hid the roster. Orca dropped the stopped
  // row and started it afresh, so its start moved; the run is the resumed one.
  // (Whether the count lists it is the task memory's call; the clock is what
  // the sheet times it by.)
  it('times an agent resumed while a stand-in hid the roster from its resume', () => {
    vi.setSystemTime(at('08:45:02.000'))
    const row = hookRow('claude', 'tab-1', { ...roster(rosterRow(AGENT, at('08:45:00.000'))), updatedAt: at('08:45:01.000') })
    show('claude', row)
    show('claude', row, { connState: 'disconnected' })
    vi.setSystemTime(at('09:59:40.000'))
    show('claude', standIn('claude', 'tab-1', 'working', '09:59:40.000'))
    vi.setSystemTime(at('10:00:00.000'))
    show('claude', hookRow('claude', 'tab-1', { ...roster(rosterRow(AGENT, at('09:59:45.000'))), updatedAt: at('09:59:59.000') }))
    expect(runs?.get(AGENT)).toBe(at('09:59:45.000'))
  })

  // While the phone watches, the stop is a hook row: SubagentStop takes the
  // pane back from the title (agent-status-stand-in.ts), the agent leaves the
  // roster, and the resume is a new run.
  it('times an agent resumed while the phone watched from its resume, the stop seen as a row', () => {
    vi.setSystemTime(at('08:45:02.000'))
    show('claude', hookRow('claude', 'tab-1', { ...roster(rosterRow(AGENT, at('08:45:00.000'))), updatedAt: at('08:45:01.000') }))
    show('claude', standIn('claude', 'tab-1', 'working', '09:30:00.000'))
    vi.setSystemTime(at('09:59:30.000'))
    show('claude', hookRow('claude', 'tab-1', { ...roster(), updatedAt: at('09:59:30.000') }))
    show('claude', standIn('claude', 'tab-1', 'working', '09:59:35.000'))
    vi.setSystemTime(at('10:00:00.000'))
    show('claude', hookRow('claude', 'tab-1', { ...roster(rosterRow(AGENT, at('09:59:45.000'))), updatedAt: at('09:59:59.000') }))
    expect(runs?.get(AGENT)).toBe(at('09:59:45.000'))
  })

  // A limit, pinned (the review of 7e632bbb, its finding 3): a stop can hide
  // behind a stand-in read through. The agent was the idle lead's last
  // background work, so its SubagentStop row is the all-clear `done`; Claude
  // wakes the lead with the agent's notification and the spinner title lands
  // after that row, inside Orca's flush, so Orca sends a `working` stand-in in
  // its place, read through; the same after an interrupted turn, which Orca
  // stamps no turn end on. The lead's first row lists the agent resumed, and
  // the clock, which never sees a stand-in read through, keeps the first run.
  // Telling it of one broke the nested case wherever a stand-in fell before
  // the nested run (a permission prompt on the Bash that runs it, or a
  // background `claude -p` after the lead's turn), and limiting that to
  // Orca's turn end missed the interrupted turn (the reviews of 078a79b9 and
  // f69b5253). The kept start shows only once the loaded window has moved
  // past the lead's resume (use-subagent-run-clock.test.ts).
  it('keeps the first run for an agent resumed after a stop row the spinner title stood in for, while the phone watched (a limit)', () => {
    const TURN_END = { turnCompletedAt: at('08:45:10.000') }
    vi.setSystemTime(at('08:45:12.000'))
    show('claude', hookRow('claude', 'tab-1', { ...roster(rosterRow(AGENT, at('08:45:00.000'))), updatedAt: at('08:45:10.000'), ...TURN_END }), TURN_END)
    show('claude', standIn('claude', 'tab-1', 'done', '08:45:10.300'), TURN_END)
    vi.setSystemTime(at('09:59:41.000'))
    show('claude', standIn('claude', 'tab-1', 'working', '09:59:40.100'), TURN_END)
    vi.setSystemTime(at('10:00:00.000'))
    show('claude', hookRow('claude', 'tab-1', { ...roster(rosterRow(AGENT, at('09:59:45.000'))), updatedAt: at('09:59:45.100') }))
    expect(runs?.get(AGENT)).toBe(at('08:45:00.000'))
  })

  // The nested run's own statuses reach the chat: its SessionStart row and its
  // prompt row name another session, and a spinner stand-in over them copies
  // that session. The task readers read none of them (the 'nested' reading),
  // so they neither end the run nor hide the roster.
  const NESTED = { key: 'session_id' as const, id: '9c1f4e22-8a7b-4d10-b3e5-6f0a2c9d8e71', transcriptPath: '/x/9c1f4e22-8a7b-4d10-b3e5-6f0a2c9d8e71.jsonl' }
  /** Another tab's own Claude session. */
  const otherTab = (clock: string) =>
    hookRow('claude', 'tab-2', { providerSession: { key: 'session_id' as const, id: '3b7a0d55-1e2f-4c9a-8b6d-7e5f4a3c2b10', transcriptPath: '/y/3b7a0d55-1e2f-4c9a-8b6d-7e5f4a3c2b10.jsonl' }, updatedAt: at(clock) })
  const firstRun = () => hookRow('claude', 'tab-1', { ...roster(rosterRow(AGENT, at('08:45:00.000'))), updatedAt: at('08:45:01.000') })
  const recreated = (updated: string) => hookRow('claude', 'tab-1', { ...roster(rosterRow(AGENT, at('09:59:30.000'))), updatedAt: at(updated) })
  it('keeps timing the lead’s agent from its first start with the nested run’s statuses in between', () => {
    vi.setSystemTime(at('08:45:02.000'))
    show('claude', firstRun())
    vi.setSystemTime(at('09:59:00.100'))
    show('claude', hookRow('claude', 'tab-1', { state: 'done', sessionBoundary: true, prompt: '', providerSession: NESTED, updatedAt: at('09:59:00.000') }))
    expect(controller?.nativeChatAgentStatus).toBeNull()
    vi.setSystemTime(at('09:59:10.100'))
    show('claude', hookRow('claude', 'tab-1', { state: 'working', prompt: 'nested', providerSession: NESTED, updatedAt: at('09:59:10.000') }))
    vi.setSystemTime(at('09:59:20.300'))
    show('claude', { ...standIn('claude', 'tab-1', 'working', '09:59:20.200'), providerSession: NESTED } as AgentStatusEntry)
    vi.setSystemTime(at('09:59:30.100'))
    show('claude', recreated('09:59:30.000'))
    expect(runTime(AGENT, '10:00:00.000')).toBe('1h 15m')
  })

  // The review of 078a79b9 (its finding 2): the Bash that runs `claude -p`
  // asks permission. The PermissionRequest row (`waiting`, the agent at its
  // first start) is the lead's last roster read; on approval the spinner title
  // lands after it and disagrees, so Orca stands a `working` title in for it,
  // read through. It says nothing of the roster, and the re-creation in the
  // nested run is no resume.
  it('keeps timing the lead’s agent from its first start across a nested claude behind a permission prompt', () => {
    vi.setSystemTime(at('08:45:02.000'))
    show('claude', firstRun())
    vi.setSystemTime(at('09:58:55.100'))
    show('claude', hookRow('claude', 'tab-1', { ...roster(rosterRow(AGENT, at('08:45:00.000'))), toolName: 'Bash', updatedAt: at('09:58:55.000') }))
    vi.setSystemTime(at('09:58:55.300'))
    show('claude', hookRow('claude', 'tab-1', { ...roster(rosterRow(AGENT, at('08:45:00.000'))), state: 'waiting', toolName: 'Bash', updatedAt: at('09:58:55.200') }))
    vi.setSystemTime(at('09:58:58.300'))
    show('claude', standIn('claude', 'tab-1', 'working', '09:58:58.200'))
    expect(controller?.nativeChatAgentStatus?.subagents?.map((row) => row.id)).toEqual([AGENT])
    vi.setSystemTime(at('09:59:00.100'))
    show('claude', hookRow('claude', 'tab-1', { state: 'done', sessionBoundary: true, prompt: '', providerSession: NESTED, updatedAt: at('09:59:00.000') }))
    vi.setSystemTime(at('09:59:30.100'))
    show('claude', recreated('09:59:30.000'))
    expect(runTime(AGENT, '10:00:00.000')).toBe('1h 15m')
  })

  // The review of f69b5253 (R3-2): the lead ends its turn with the agent
  // running and a background Bash that runs `claude -p` later. The idle
  // title's `done` stand-in is read through under Orca's turn end; the agent
  // makes no call before the nested SessionStart, and the beacon names the
  // lead, so the nested statuses are the nested run's. A read-through stand-in
  // says nothing of the roster, and the re-creation is no resume.
  it('keeps timing the lead’s agent across a background nested claude that starts after the lead’s turn ended', () => {
    const TURN_END = { turnCompletedAt: at('08:45:10.000') }
    vi.setSystemTime(at('08:45:02.000'))
    show('claude', firstRun())
    vi.setSystemTime(at('08:45:10.100'))
    show('claude', hookRow('claude', 'tab-1', { ...roster(rosterRow(AGENT, at('08:45:00.000'))), updatedAt: at('08:45:10.000'), ...TURN_END }), TURN_END)
    vi.setSystemTime(at('08:45:10.400'))
    show('claude', standIn('claude', 'tab-1', 'done', '08:45:10.300'), TURN_END)
    expect(controller?.nativeChatAgentStatus?.subagents?.map((row) => row.id)).toEqual([AGENT])
    vi.setSystemTime(at('09:58:58.000'))
    act(() => {
      consumeAgentHudBeacons('term-tab-1', BEACON)
    })
    show('claude', standIn('claude', 'tab-1', 'done', '08:45:10.300'), TURN_END)
    vi.setSystemTime(at('09:59:00.100'))
    show('claude', hookRow('claude', 'tab-1', { state: 'done', sessionBoundary: true, prompt: '', providerSession: NESTED, updatedAt: at('09:59:00.000') }), TURN_END)
    expect(controller?.nativeChatAgentStatus).toBeNull()
    vi.setSystemTime(at('09:59:30.100'))
    show('claude', { ...recreated('09:59:30.000'), ...TURN_END }, TURN_END)
    expect(runTime(AGENT, '10:00:00.000')).toBe('1h 15m')
  })

  // The review of 7e632bbb (its finding 1): after the re-creation the host's
  // start stays 09:59:30. A stand-in read as it comes after a reconnect, or
  // after a switch back from another tab, took that unmoved start for a
  // resume, timed from the phone's now: "0s".
  it.each([
    ['a reconnect', { connState: 'disconnected' as const }, 'working' as const, {}],
    ['a switch back from another tab', { tab: 'tab-2' }, 'done' as const, { turnCompletedAt: at('09:59:50.000') }]
  ])('keeps timing the lead’s agent from its first start while the nested claude runs, through %s to a stand-in', (_label, gap, state, turnEnd) => {
    vi.setSystemTime(at('08:45:02.000'))
    show('claude', firstRun())
    vi.setSystemTime(at('10:00:00.000'))
    show('claude', { ...recreated('09:59:50.000'), ...turnEnd }, turnEnd)
    expect(runTime(AGENT, '10:00:00.000')).toBe('1h 15m')
    vi.setSystemTime(at('10:05:00.000'))
    if ('tab' in gap) {
      show('claude', otherTab('10:05:00.000'), { tab: 'tab-2' })
    } else {
      show('claude', { ...recreated('09:59:50.000'), ...turnEnd }, { ...gap, ...turnEnd })
    }
    vi.setSystemTime(at('10:10:05.000'))
    show('claude', standIn('claude', 'tab-1', state, '10:10:04.000'), turnEnd)
    vi.setSystemTime(at('10:10:10.000'))
    show('claude', { ...recreated('10:10:08.000'), ...turnEnd }, turnEnd)
    expect(runTime(AGENT, '10:10:10.000')).toBe('1h 25m')
  })

  // A limit, pinned (the review of 7e632bbb, its finding 2): the clock reads
  // nothing while the chat shows another tab, is closed, or the link is down,
  // and the first status back can be a hook row. An agent resumed in that gap
  // keeps its first run. Taking such a gap as a hidden roster would time every
  // agent a nested claude re-created while the user was away from its
  // re-creation, and the sheet times an agent by this clock only when the
  // loaded window holds neither its launch nor the lead's resume of it.
  it('keeps the first run for an agent resumed while the chat showed another tab (a limit)', () => {
    vi.setSystemTime(at('08:45:02.000'))
    show('claude', firstRun())
    vi.setSystemTime(at('09:00:00.000'))
    show('claude', otherTab('09:00:00.000'), { tab: 'tab-2' })
    vi.setSystemTime(at('10:00:00.000'))
    show('claude', hookRow('claude', 'tab-1', { ...roster(rosterRow(AGENT, at('09:59:45.000'))), updatedAt: at('09:59:59.000') }))
    expect(runs?.get(AGENT)).toBe(at('08:45:00.000'))
  })
})
