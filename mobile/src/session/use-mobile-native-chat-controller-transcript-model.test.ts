import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The controller composes many session hooks; the ones that would reach the
// transport or disk are stubbed to a minimal shape, as in
// use-mobile-native-chat-controller-beacon-gate.test.ts. The HUD is stubbed at
// its own output so each case can say whether the agent has spoken (a beacon
// or the badge on the user's own status line) — the live pair. The beacon
// store and the RPC client are REAL: the host answers through the same fake
// transport the agent-history suites use.
const fakes = vi.hoisted(() => ({
  live: { model: null, label: null, effort: null, context: null } as {
    model: string | null
    label: string | null
    effort: string | null
    context: null
  }
}))
vi.mock('./use-mobile-native-chat-hud', async () => {
  const actual = await vi.importActual<typeof import('./use-mobile-native-chat-hud')>(
    './use-mobile-native-chat-hud'
  )
  return {
    ...actual,
    useMobileNativeChatHud: () => ({
      observation: null,
      live: fakes.live,
      refresh: async () => null,
      dialogOptions: null,
      dialogKind: null,
      terminalPermission: null,
      permissionDismissed: false,
      queuedMessages: [],
      sentPrompts: [],
      taskCompletions: [],
      peerNotices: [],
      spinner: null,
      sentPhotos: []
    })
  }
})
vi.mock('./use-mobile-session-view-mode', () => ({
  useMobileSessionViewMode: () => ({ isTabChatView: () => true, toggleTabChatView: vi.fn() })
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => null
}))
vi.mock('./use-mobile-native-chat-session', () => ({
  useMobileNativeChatSession: () => ({ messages: [], status: 'ready', transcriptLoading: false })
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

import {
  createAnsweringClient,
  historySession,
  ok,
  refused,
  type AnsweringClient
} from '../agent-history/agent-history-panel.test-support'
import { consumeAgentHudBeacons, resetAgentHudBeacons } from './agent-hud-beacon'
import {
  useMobileNativeChatController,
  type MobileNativeChatController
} from './use-mobile-native-chat-controller'

const ESC = '\u001b'
const BEL = '\u0007'
const OWN = 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607'
const NEIGHBOUR = '8b19cb22-996c-40e5-a887-a5323a9845e1'
const FOLDER = 'C:\\Users\\danny\\code\\app'

// A Windows host: Code UI writes no beacon flag there (hostTakesAgentHudFlag,
// agent-hud-launch-args.ts), and this user has no status line of their own, so
// the phone hears nothing from the agent about its model. Before this, the
// header pill showed nothing and the composer pill read "Model" (reported
// 2026-09-27: "On Windows systems they can't read from the statusline, so it
// shows just 'model'"). The host's session list answers with what Claude
// Code's transcript recorded for the session's last reply.
const ownRow = historySession({
  id: `claude:${OWN}`,
  sessionId: OWN,
  cwd: FOLDER,
  model: 'claude-opus-5-5',
  previewMessages: [{ role: 'assistant', text: 'Done.', timestamp: '2026-09-27T10:00:30.000Z' }]
})
const neighbourRow = historySession({
  id: `claude:${NEIGHBOUR}`,
  sessionId: NEIGHBOUR,
  cwd: FOLDER,
  model: 'claude-fable-5-1'
})

describe('the model pills on a Claude chat whose agent states no model', () => {
  let renderer: ReactTestRenderer | null = null
  let controller: MobileNativeChatController | null = null
  let host: AnsweringClient
  let sessions: unknown[] = [neighbourRow, ownRow]
  let hostCount = 0
  const tab = {
    type: 'terminal',
    id: 'tab-1',
    terminal: 'term-1',
    launchAgent: 'claude',
    agentStatus: { state: 'done', agentType: 'claude', providerSession: { id: OWN } },
    isActive: true
  }

  function Harness(): null {
    controller = useMobileNativeChatController({
      client: host.client,
      connState: 'connected',
      tabsLive: true,
      hostId: `host-win-${String(hostCount)}`,
      worktreeId: `repo-1::${FOLDER}`,
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

  async function settle(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  function rerender(): void {
    act(() => renderer?.update(createElement(Harness)))
  }

  function pills() {
    return {
      header: controller?.nativeChatLiveModel,
      composer: controller?.nativeChatSessionOptions?.liveModel
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-09-27T10:10:00.000Z'))
    resetAgentHudBeacons()
    // A host of its own per case: the five-minute budget is per host and
    // outlives the component, which is the point of it.
    hostCount += 1
    fakes.live = { model: null, label: null, effort: null, context: null }
    sessions = [neighbourRow, ownRow]
    host = createAnsweringClient((method) =>
      method === 'aiVault.listSessions'
        ? ok({ sessions, issues: [] })
        : refused('method_not_found', `not answered by this suite: ${method}`)
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    act(() => {
      renderer = create(createElement(Harness))
    })
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    controller = null
    resetAgentHudBeacons()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shows the model that answered on a Windows host with no status line', async () => {
    await settle(10_000)

    expect(host.sent('aiVault.listSessions')).toHaveLength(1)
    expect(host.sent('aiVault.listSessions')[0]?.params).toEqual({
      limit: 20,
      force: false,
      scopePaths: [FOLDER]
    })
    // The session's own row, not the newer neighbour listed above it; the name
    // only, since the transcript records no effort and no window size.
    const opus = { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: null }
    expect(pills().header).toEqual(opus)
    expect(pills().composer).toEqual(opus)
  })

  it('shows nothing when the host lists every session but this one', async () => {
    sessions = [neighbourRow]
    await settle(10_000)

    expect(host.sent('aiVault.listSessions')).toHaveLength(1)
    expect(pills().header?.model).toBeNull()
    expect(pills().composer?.model ?? null).toBeNull()
  })

  it('lets the beacon win over the transcript, and asks the host nothing', async () => {
    fakes.live = { model: 'claude-fable-5-1', label: 'Fable 5.1', effort: 'medium', context: null }
    act(() => {
      consumeAgentHudBeacons(
        'term-1',
        `${ESC}]7777;CUIHUD1 agent=claude sid=${OWN} model=claude-fable-5-1 name=Fable%205.1 effort=medium${BEL}`
      )
    })
    rerender()
    await settle(60_000)

    expect(host.sent('aiVault.listSessions')).toHaveLength(0)
    expect(pills().header).toEqual({ model: 'claude-fable-5-1', label: 'Fable 5.1', effort: 'medium' })
  })

  it('gives way to a live pair that arrives after the scan', async () => {
    await settle(10_000)
    expect(pills().header?.label).toBe('Opus 5.5')

    fakes.live = { model: 'claude-sonnet-5', label: 'Sonnet 5', effort: 'high', context: null }
    rerender()

    expect(pills().header).toEqual({ model: 'claude-sonnet-5', label: 'Sonnet 5', effort: 'high' })
    expect(pills().composer).toEqual({ model: 'claude-sonnet-5', label: 'Sonnet 5', effort: 'high' })
  })

  it('asks again at most once per five minutes, however often the chat reopens', async () => {
    await settle(10_000)
    for (let reopen = 0; reopen < 3; reopen += 1) {
      act(() => renderer?.unmount())
      act(() => {
        renderer = create(createElement(Harness))
      })
      await settle(10_000)
    }
    expect(host.sent('aiVault.listSessions')).toHaveLength(1)
    // Reopened, it states what the one scan said without waiting.
    expect(pills().header?.label).toBe('Opus 5.5')
  })

  it('shows nothing when the host refuses the scan', async () => {
    host = createAnsweringClient(() => refused('method_not_found', 'Unknown method: aiVault.listSessions'))
    rerender()
    await settle(10_000)

    expect(host.sent('aiVault.listSessions')).toHaveLength(1)
    expect(pills().header?.model).toBeNull()
    expect(pills().composer?.model ?? null).toBeNull()
  })
})
