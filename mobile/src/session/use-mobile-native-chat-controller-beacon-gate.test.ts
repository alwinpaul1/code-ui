import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'

// The controller composes many session hooks; the ones that would reach the
// transport or disk are stubbed to a minimal shape. The beacon store is REAL:
// this suite is about which beacon the controller lets through.
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
const draftsArgs: { beaconPromptReceipts?: readonly { nonce: string }[] }[] = []
vi.mock('./use-mobile-native-chat-drafts', () => ({
  useMobileNativeChatDrafts: (args: { beaconPromptReceipts?: readonly { nonce: string }[] }) => {
    draftsArgs.push(args)
    return {
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
    }
  }
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
import {
  useMobileNativeChatController,
  type MobileNativeChatController
} from './use-mobile-native-chat-controller'

const ESC = '\u001b'
const BEL = '\u0007'
const OWN = 'session-1'
const OTHER = '8b19cb22-996c-40e5-a887-a5323a9845e1'

// 2026-09-18: the beacon store is keyed by terminal handle and a handle
// outlives the process that emitted into it, so the running-tasks row, the
// desktop-prompt echoes and the prompt-hook flag all read a dead process's
// beacon for the hand-started session that took over its terminal. The
// controller lets only the beacon of the session the tab is showing through.
describe('what the controller takes from a beacon on the active terminal', () => {
  let renderer: ReactTestRenderer | null = null
  let controller: MobileNativeChatController | null = null
  const clientStub = { sendRequest: vi.fn(), getState: () => 'connected' as const, notifyForeground: vi.fn() }
  const tab = {
    type: 'terminal',
    id: 'tab-1',
    terminal: 'term-1',
    launchAgent: 'claude',
    agentStatus: { state: 'working', agentType: 'claude', providerSession: { id: OWN } },
    isActive: true
  }

  function Harness(): null {
    controller = useMobileNativeChatController({
      client: clientStub as unknown as RpcClient,
      connState: 'connected',
      hostId: 'h',
      worktreeId: 'w',
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

  function beacon(fields: string) {
    act(() => {
      consumeAgentHudBeacons('term-1', `${ESC}]7777;CUIHUD1 agent=claude ${fields}${BEL}`)
    })
    act(() => renderer?.update(createElement(Harness)))
  }

  beforeEach(() => {
    resetAgentHudBeacons()
    draftsArgs.length = 0
    act(() => {
      renderer = create(createElement(Harness))
    })
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    controller = null
    tab.agentStatus.providerSession.id = OWN
    resetAgentHudBeacons()
  })

  it('shows no background tasks from a beacon another session left on the same handle', () => {
    beacon(`sid=${OTHER} model=m bg=b1,b2 done=b1 live=b2`)
    expect(controller?.nativeChatBackgroundTaskReport).toMatchObject({
      runningTaskIds: null,
      launchedTaskIds: [],
      finishedTaskIds: []
    })
  })

  it('takes the background tasks of the tab\'s own session, as before', () => {
    beacon(`sid=${OWN} model=m bg=b3,b4 done=b3 live=b4`)
    expect(controller?.nativeChatBackgroundTaskReport).toMatchObject({
      runningTaskIds: ['b4'],
      launchedTaskIds: ['b3', 'b4'],
      finishedTaskIds: ['b3']
    })
  })

  it('forgets the finished ids it remembered once the tab moves to another session', () => {
    beacon(`sid=${OWN} model=m bg=b3 done=b3 live=`)
    expect(controller?.nativeChatBackgroundTaskReport.finishedTaskIds).toEqual(['b3'])
    // The new process's beacon replaces the store's record before the host
    // has reported the new session: what the tab's OWN session said about its
    // finished shells is still what the tab is showing.
    beacon(`sid=${OTHER} model=m bg=b9 done=b9 live=`)
    expect(controller?.nativeChatBackgroundTaskReport.finishedTaskIds).toEqual(['b3'])
    // The host catches up: the tab is now the other session, and nothing the
    // previous one said applies. Its own beacon's lists do.
    tab.agentStatus.providerSession.id = OTHER
    act(() => renderer?.update(createElement(Harness)))
    expect(controller?.nativeChatBackgroundTaskReport.finishedTaskIds).toEqual(['b9'])
  })

  it('echoes no desktop prompt, and claims no prompt hook, from another session\'s beacon', () => {
    beacon(`hk=1 sid=${OTHER} up=41:typed%20on%20the%20desk`)
    expect(controller?.nativeChatDesktopPrompts).toEqual([])
    expect(controller?.nativeChatPromptHook).toBeNull()
    expect(draftsArgs.at(-1)?.beaconPromptReceipts).toBeUndefined()
    beacon(`hk=1 sid=${OWN} up=42:typed%20on%20the%20desk`)
    expect(controller?.nativeChatDesktopPrompts).toEqual([{ nonce: '42', text: 'typed on the desk', cut: false }])
    expect(controller?.nativeChatPromptHook).toBe(true)
    expect(draftsArgs.at(-1)?.beaconPromptReceipts?.map((r) => r.nonce)).toEqual(['42'])
  })
})
