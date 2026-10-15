import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import type { CcrEvent } from './ccr-session-api'
import type { ClaudeAnthropicTranscript } from './use-claude-anthropic-transcript'

/**
 * The Claude app sends every control action of a Claude Code session as a `control_request` on
 * the session's events (parity audit 2026-10-15, gaps 1-5), so Stop, the mode and permission
 * answers keep working while the relay to the desktop is down. A Claude tab matched to its Remote
 * Control session, its Anthropic stream live and the relay DOWN, does the same here: nothing of
 * this goes through the terminal.
 */

const SESSION = 'session-1'
const CSE = 'cse_01NmzBrN6cdXv6SaRde5pR7H'
const CONFIG_DIR = '/Users/me/.claude'
const orca = { messages: [] as NativeChatMessage[], status: 'ready', transcriptLoading: false }
const api: ClaudeAnthropicTranscript = { gate: { kind: 'off' }, session: null, live: null, linkPhase: null, connectionStatus: null, events: [] }
const posted: { accountId: string; sessionId: string; body: { events: { payload: Record<string, unknown> }[] } }[] = []

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
              posted.push({ accountId, sessionId, body: JSON.parse(init.body ?? 'null') })
              return { ok: true, status: 200, json: async () => ({ results: [] }) }
            }
          },
          accountId,
          sessionId
        ),
      controlWaiters: { wait: () => ({ reply: new Promise(() => undefined), cancel: () => undefined }) }
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

import { bindCcrConfigDir, resetCcrCacheForTests, setCcrMapping } from './ccr-session-cache'
import { useMobileNativeChatController, type MobileNativeChatController } from './use-mobile-native-chat-controller'

let seq = 0
const event = (payload: Record<string, unknown>): CcrEvent => ({ eventId: `e${(seq += 1)}`, sequenceNum: seq, payload: { uuid: `u${seq}`, ...payload } })

describe('the control actions of a Claude tab matched to its Remote Control session, relay down', () => {
  let renderer: ReactTestRenderer | null = null
  let controller: MobileNativeChatController | null = null
  const sendRequest = vi.fn(async () => ({ ok: true }))
  const clientStub = { sendRequest, getState: () => 'disconnected' as const, getLastConnectedAt: () => 1, notifyForeground: vi.fn() }
  const onSendError = vi.fn()
  const tab = {
    type: 'terminal',
    id: 'tab-1',
    terminal: 'term-1',
    launchAgent: 'claude',
    isActive: true,
    agentStatus: { state: 'working', updatedAt: 1, agentType: 'claude', providerSession: { id: SESSION, transcriptPath: `${CONFIG_DIR}/projects/-Users-me-p/${SESSION}.jsonl` } }
  }

  function Harness(): null {
    controller = useMobileNativeChatController({
      client: clientStub as unknown as RpcClient,
      connState: 'disconnected',
      tabsLive: true,
      hostId: 'h',
      worktreeId: 'w',
      activeSessionTab: tab as never,
      activeSessionTabId: 'tab-1',
      activeHandle: 'term-1',
      activeHandleRef: { current: 'term-1' },
      deviceTokenRef: { current: null },
      nativeChatTranscriptIsLocalReadable: true,
      nativeChatInputLeaseReady: false,
      onSendError,
      onSendResolved: vi.fn()
    })
    return null
  }
  const terminalWrites = () => sendRequest.mock.calls.filter((call) => JSON.stringify(call).includes('terminal.send'))
  const payloads = () => posted.map((post) => post.body.events[0]!.payload)

  beforeEach(() => {
    resetCcrCacheForTests()
    setCcrMapping('tab-1', CSE, null, 'acct-personal', SESSION, CONFIG_DIR)
    bindCcrConfigDir(CONFIG_DIR, 'acct-personal')
    posted.length = 0
    sendRequest.mockClear()
    onSendError.mockClear()
    Object.assign(api, {
      gate: { kind: 'matched', accountId: 'acct-personal', sessionId: CSE },
      session: { messages: [], status: 'ready', transcriptLoading: false, hasMore: false, loadingEarlier: false, loadEarlier: () => undefined },
      live: null,
      linkPhase: 'live',
      connectionStatus: 'connected',
      events: []
    })
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

  it('says its Anthropic control lane drives the tab, so the composer is not locked on the terminal lease', () => {
    render()
    expect(controller!.nativeChatAnthropicControl?.live).toBe(true)
  })

  it('stops the turn with an interrupt into its own session, not an Escape into the terminal', async () => {
    render()
    await act(async () => {
      controller!.handleNativeChatStop()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(payloads()).toEqual([{ type: 'control_request', uuid: expect.any(String), request_id: expect.any(String), request: { subtype: 'interrupt' } }])
    expect(posted[0]!.accountId).toBe('acct-personal')
    expect(posted[0]!.sessionId).toBe(CSE)
    expect(terminalWrites()).toEqual([])
    expect(onSendError).not.toHaveBeenCalled()
  })

  it('reads the mode pill from the session’s own system event', () => {
    api.events = [event({ type: 'system', subtype: 'init', permissionMode: 'auto' })]
    render()
    expect(controller!.nativeChatPermissionMode).toBe('auto')
  })

  it('draws Anthropic’s permission prompt as the card and answers it with a control_response', async () => {
    api.events = [event({ type: 'control_request', request_id: 'req-1', request: { subtype: 'can_use_tool', tool_name: 'Bash', tool_use_id: 'toolu_1', input: { command: 'npm test' } } })]
    render()
    const card = controller!.nativeChatPermission
    expect(card?.title).toBe('Allow Bash?')
    await act(async () => {
      await controller!.handleNativeChatRespondPermission(card!.options[0]!.send)
    })
    expect(payloads()).toEqual([
      { type: 'control_response', uuid: expect.any(String), response: { subtype: 'success', request_id: 'req-1', response: { behavior: 'allow', toolUseID: 'toolu_1', tool_name: 'Bash', updatedInput: { command: 'npm test' } } } }
    ])
    expect(terminalWrites()).toEqual([])
  })

  it('sends a model pick from the sheet as set_model into its own session, typing no /model', async () => {
    render()
    const options = controller!.nativeChatSessionOptions?.controller
    const model = options?.snapshot.find((descriptor) => descriptor.category === 'model')
    const value = model?.kind.type === 'select' ? model.kind.choices.find((choice) => choice.value !== model.kind.currentValue)?.value : undefined
    expect(typeof value).toBe('string')
    await act(async () => {
      void options!.setOption(model!.id, value!)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(payloads()).toEqual([{ type: 'control_request', uuid: expect.any(String), request_id: expect.any(String), request: { subtype: 'set_model', model: value } }])
    expect(terminalWrites()).toEqual([])
  })

  it('keeps the terminal paths when the Anthropic stream is not live', () => {
    api.linkPhase = 'reconnecting'
    api.events = [event({ type: 'system', subtype: 'init', permissionMode: 'auto' })]
    render()
    expect(controller!.nativeChatAnthropicControl?.live).toBe(false)
    expect(controller!.nativeChatAnthropicControl?.setPermissionMode).toBeUndefined()
    expect(controller!.nativeChatPermissionMode).toBeNull()
  })
})
