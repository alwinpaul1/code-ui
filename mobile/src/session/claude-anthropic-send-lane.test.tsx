import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import type { ClaudeAnthropicTranscript } from './use-claude-anthropic-transcript'

/**
 * "Send messages from anthropic api for that session transcript like remote control not from
 * terminal so no more writing into terminal of the host" (user, 2026-10-15). A Claude tab matched
 * to its Remote Control session sends its composer's words as a POST into that session
 * (use-ccr-composer-send.ts) and never through `terminal.send`, offline included: the app's
 * offline refusal, not a fallback to typing. Every other tab keeps its terminal path and its
 * screen-read queue box.
 */

const SESSION = 'session-1'
const CSE = 'cse_01NmzBrN6cdXv6SaRde5pR7H'
const CONFIG_DIR = '/Users/me/.claude'
const orca = { messages: [] as NativeChatMessage[], status: 'ready', transcriptLoading: false }
const api: ClaudeAnthropicTranscript = { gate: { kind: 'off' }, session: null, live: null, linkPhase: null, connectionStatus: null, events: [] }
const posted: { accountId: string; sessionId: string; body: unknown }[] = []

vi.mock('../transport/client-context-connection-metrics', () => ({ useLastConnectedAt: () => null }))
vi.mock('./use-mobile-session-view-mode', () => ({ useMobileSessionViewMode: () => ({ isTabChatView: () => true, toggleTabChatView: vi.fn() }) }))
vi.mock('./use-mobile-native-chat-session', () => ({ useMobileNativeChatSession: () => orca }))
vi.mock('./use-claude-anthropic-transcript', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./use-claude-anthropic-transcript')>()),
  useClaudeAnthropicTranscript: () => api
}))
vi.mock('./ccr-link-registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ccr-link-registry')>()),
  acquireCcrLink: (accountId: string, sessionId: string) => ({
    link: {
      // The real link's: runs the request with its own deps; the deps' fetch records the POST.
      withSession: (run: (deps: unknown, account: string, session: string) => Promise<unknown>) =>
        run(
          {
            auth: async () => ({ token: 'test-token', organizationUuid: 'org' }),
            fetch: async (_url: string, init: { method: string; body?: string }) => {
              if (init.method === 'POST') {
                posted.push({ accountId, sessionId, body: JSON.parse(init.body ?? 'null') })
                return { ok: true, status: 200, json: async () => ({ attestation_feedback: null, results: [] }) }
              }
              return { ok: true, status: 200, json: async () => ({ id: sessionId, connection_status: 'connected' }) }
            }
          },
          accountId,
          sessionId
        )
    },
    release: () => undefined
  })
}))
vi.mock('./use-mobile-native-chat-drafts', () => ({
  useMobileNativeChatDrafts: () => ({
    composerText: '',
    setComposerText: vi.fn(),
    pending: [],
    imagePreviewsByMessageId: {},
    captureSendOrigin: (text: string) => ({ draftKey: 'k', draftEditGeneration: 0, pendingKey: 'p', normalizedText: text, baselineOccurrences: 0, baselineTailMessageId: null, baselineResolved: true }),
    getComposerEditGeneration: () => 0,
    readSeededLaunchDraft: () => null,
    readSeededLaunchDraftSeed: () => null,
    clearDraftForSend: vi.fn(),
    restoreRejectedDraft: vi.fn(),
    acceptSend: () => 'row-1',
    removePending: vi.fn(),
    holdUnconfirmedSend: vi.fn()
  })
}))
vi.mock('./use-mobile-native-chat-outbox', () => ({ useMobileNativeChatOutbox: () => ({ deliveries: {}, retry: vi.fn(), edit: vi.fn() }) }))
vi.mock('./use-mobile-native-chat-composer-catalogs', () => ({
  useMobileNativeChatComposerCatalogs: () => ({ nativeChatFilePaths: [], loadNativeChatFiles: vi.fn(), nativeChatSkills: [], loadNativeChatSkills: vi.fn() })
}))

import { CCR_REMOTE_CONTROL_OFFLINE } from './ccr-send'
import { bindCcrConfigDir, resetCcrCacheForTests, setCcrMapping } from './ccr-session-cache'
import { useMobileNativeChatController, type MobileNativeChatController } from './use-mobile-native-chat-controller'

describe('the composer send of a Claude tab matched to its Remote Control session', () => {
  let renderer: ReactTestRenderer | null = null
  let controller: MobileNativeChatController | null = null
  const sendRequest = vi.fn(async () => ({ ok: true }))
  const clientStub = { sendRequest, getState: () => 'connected' as const, getLastConnectedAt: () => 1, notifyForeground: vi.fn() }
  const onSendError = vi.fn()
  const tab = (agent: 'claude' | 'codex') => ({
    type: 'terminal',
    id: 'tab-1',
    terminal: 'term-1',
    launchAgent: agent,
    isActive: true,
    agentStatus: {
      state: 'idle',
      updatedAt: 1,
      agentType: agent,
      providerSession: { id: SESSION, transcriptPath: agent === 'claude' ? `${CONFIG_DIR}/projects/-Users-me-p/${SESSION}.jsonl` : `/Users/me/.codex/sessions/2026/10/15/rollout-${SESSION}.jsonl` }
    }
  })
  let agent: 'claude' | 'codex' = 'claude'

  function Harness(): null {
    controller = useMobileNativeChatController({
      client: clientStub as unknown as RpcClient,
      connState: 'connected',
      tabsLive: true,
      hostId: 'h',
      worktreeId: 'w',
      activeSessionTab: tab(agent) as never,
      activeSessionTabId: 'tab-1',
      activeHandle: 'term-1',
      activeHandleRef: { current: 'term-1' },
      deviceTokenRef: { current: null },
      nativeChatTranscriptIsLocalReadable: true,
      nativeChatInputLeaseReady: true,
      onSendError,
      onSendResolved: vi.fn()
    })
    return null
  }
  // Every RPC naming terminal.send, as a method argument or inside a request object.
  const terminalWrites = () => sendRequest.mock.calls.filter((call) => JSON.stringify(call).includes('terminal.send'))

  beforeEach(() => {
    resetCcrCacheForTests()
    setCcrMapping('tab-1', CSE, null, 'acct-personal', SESSION, CONFIG_DIR)
    bindCcrConfigDir(CONFIG_DIR, 'acct-personal')
    posted.length = 0
    sendRequest.mockClear()
    onSendError.mockClear()
    agent = 'claude'
    Object.assign(api, { gate: { kind: 'matched', accountId: 'acct-personal', sessionId: CSE }, session: { messages: [], status: 'ready', transcriptLoading: false, hasMore: false, loadingEarlier: false, loadEarlier: () => undefined }, connectionStatus: 'connected', events: [] })
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    controller = null
  })
  function render(): void {
    act(() => {
      renderer = create(createElement(Harness))
    })
  }

  it('posts the words into its own session and types nothing into the terminal', async () => {
    render()
    let sent = false
    await act(async () => {
      sent = (await controller!.nativeChatAnthropicSend?.('run the tests')) ?? false
    })
    expect(sent).toBe(true)
    expect(posted).toEqual([{ accountId: 'acct-personal', sessionId: CSE, body: { session_id: CSE, events: [{ payload: expect.objectContaining({ type: 'user', message: { role: 'user', content: 'run the tests' } }) }] } }])
    expect(terminalWrites()).toEqual([])
  })

  it('refuses with the app offline message when the Remote Control computer is offline, and never falls back to the terminal', async () => {
    api.connectionStatus = 'disconnected'
    render()
    let sent = true
    await act(async () => {
      sent = (await controller!.nativeChatAnthropicSend?.('run the tests')) ?? true
    })
    expect(sent).toBe(false)
    expect(onSendError).toHaveBeenCalledWith(CCR_REMOTE_CONTROL_OFFLINE)
    expect(posted).toEqual([])
    expect(terminalWrites()).toEqual([])
  })

  it('draws the phone-kept queue in place of the screen-read queue box', () => {
    render()
    expect(controller!.nativeChatLocalQueue).toEqual({ entries: [], onEdit: expect.any(Function) })
    expect(controller!.nativeChatQueuedMessages).toEqual([])
  })

  it('leaves a Codex tab on its terminal send and its screen-read queue box', () => {
    agent = 'codex'
    api.gate = { kind: 'off' }
    render()
    expect(controller!.nativeChatAnthropicSend).toBeUndefined()
    expect(controller!.nativeChatLocalQueue).toBeNull()
  })

  it('leaves a Claude tab with no Remote Control session on its terminal send', () => {
    api.gate = { kind: 'unmatched', detail: 'no session holds it' }
    render()
    expect(controller!.nativeChatAnthropicSend).toBeUndefined()
    expect(controller!.nativeChatLocalQueue).toBeNull()
  })
})
