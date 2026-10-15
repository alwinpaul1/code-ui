import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import type { CcrEvent } from './ccr-session-api'
import type { ClaudeAnthropicTranscript } from './use-claude-anthropic-transcript'

/**
 * The `/` menu of a Claude tab matched to its Anthropic session is the session's own list, as the
 * Claude app's is (1.261013.20: `slash_commands` from the stream's `system` event, jau.java:27,
 * su8.w4), and the app's own commands open phone sheets instead of being sent (`unm`, iu7.a,
 * ay8.java:8650): `/model` the model picker, `/workflows` Background tasks, `/diff` the changes.
 * Codex keeps its menu and its own `/model` exactly as they were.
 */

const SESSION = 'session-1'
const CSE = 'cse_01NmzBrN6cdXv6SaRde5pR7H'
const CONFIG_DIR = '/Users/me/.claude'
const orca = { messages: [] as NativeChatMessage[], status: 'ready', transcriptLoading: false }
const api: ClaudeAnthropicTranscript = { gate: { kind: 'off' }, session: null, live: null, linkPhase: null, connectionStatus: null, events: [] }
const posted: unknown[] = []
const drafts = vi.hoisted(() => ({ cleared: [] as string[] }))

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
      withSession: (run: (deps: unknown, account: string, session: string) => Promise<unknown>) =>
        run(
          {
            auth: async () => ({ token: 'test-token', organizationUuid: 'org' }),
            fetch: async (_url: string, init: { method: string; body?: string }) => {
              posted.push(JSON.parse(init.body ?? 'null'))
              return { ok: true, status: 200, json: async () => ({ results: [] }), text: async () => '' }
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
    clearDraftForSend: (_origin: unknown, text: string) => drafts.cleared.push(text),
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
import { useClaudeAppCommandSheet } from './claude-app-command-sheets'
import { useMobileNativeChatController, type MobileNativeChatController } from './use-mobile-native-chat-controller'

let seq = 0
const event = (payload: Record<string, unknown>): CcrEvent => ({ eventId: `e${(seq += 1)}`, sequenceNum: seq, payload: { uuid: `u${seq}`, ...payload } })
const INIT = () =>
  event({ type: 'system', subtype: 'init', permissionMode: 'auto', slash_commands: ['compact', 'academic-writer'], skills: ['academic-writer'], terminal_slash_commands: ['doctor'] })

describe('the app’s slash commands on a Claude tab matched to its Anthropic session', () => {
  let renderer: ReactTestRenderer | null = null
  let controller: MobileNativeChatController | null = null
  const sendRequest = vi.fn(async () => ({ ok: true }))
  const clientStub = { sendRequest, getState: () => 'connected', getLastConnectedAt: () => 1, notifyForeground: vi.fn() }
  const sheets = { diff: vi.fn(), workflows: vi.fn() }
  let agent: 'claude' | 'codex' = 'claude'
  let publish = true

  function Sheets(): null {
    useClaudeAppCommandSheet('diff', publish ? sheets.diff : null)
    useClaudeAppCommandSheet('workflows', publish ? sheets.workflows : null)
    return null
  }

  function Harness(): null {
    const tab = {
      type: 'terminal',
      id: 'tab-1',
      terminal: 'term-1',
      launchAgent: agent,
      isActive: true,
      agentStatus: { state: 'idle', updatedAt: 1, agentType: agent, providerSession: { id: SESSION, transcriptPath: `${CONFIG_DIR}/projects/-Users-me-p/${SESSION}.jsonl` } }
    }
    controller = useMobileNativeChatController({
      client: clientStub as unknown as RpcClient,
      connState: 'connected',
      tabsLive: true,
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
  const terminalWrites = () => sendRequest.mock.calls.filter((call) => JSON.stringify(call).includes('terminal.send'))

  beforeEach(() => {
    resetCcrCacheForTests()
    setCcrMapping('tab-1', CSE, null, 'acct-personal', SESSION, CONFIG_DIR)
    bindCcrConfigDir(CONFIG_DIR, 'acct-personal')
    posted.length = 0
    drafts.cleared.length = 0
    sendRequest.mockClear()
    sheets.diff.mockClear()
    sheets.workflows.mockClear()
    agent = 'claude'
    publish = true
    Object.assign(api, {
      gate: { kind: 'matched', accountId: 'acct-personal', sessionId: CSE },
      session: { messages: [], status: 'ready', transcriptLoading: false, hasMore: false, loadingEarlier: false, loadEarlier: () => undefined },
      live: null,
      linkPhase: 'live',
      connectionStatus: 'connected',
      events: [INIT()]
    })
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    controller = null
  })
  function render(): void {
    act(() => {
      renderer = create(createElement('root', null, createElement(Sheets), createElement(Harness)))
    })
  }

  it('hands the composer the session’s own list for the / menu', () => {
    render()
    expect(controller!.nativeChatSessionCommands?.map((command) => command.name)).toEqual(['compact', 'academic-writer', 'workflows', 'diff', 'model'])
  })

  it('keeps the curated catalog when the stream has stated no list', () => {
    api.events = [event({ type: 'system', subtype: 'init', permissionMode: 'auto' })]
    render()
    expect(controller!.nativeChatSessionCommands).toBeUndefined()
  })

  it('opens the model sheet for a typed /model, empties the composer and sends nothing', () => {
    render()
    const before = controller!.nativeChatSessionOptions?.openRequest ?? 0
    let handled = false
    act(() => {
      handled = controller!.nativeChatAppCommand?.('/model') ?? false
    })
    expect(handled).toBe(true)
    expect(controller!.nativeChatSessionOptions?.openRequest).toBe(before + 1)
    expect(drafts.cleared).toEqual(['/model'])
    expect(posted).toEqual([])
    expect(terminalWrites()).toEqual([])
  })

  it('opens Background tasks for /workflows and the changes for /diff', () => {
    render()
    act(() => {
      controller!.nativeChatAppCommand?.('/workflows')
      controller!.nativeChatAppCommand?.('/diff ')
    })
    expect(sheets.workflows).toHaveBeenCalledTimes(1)
    expect(sheets.diff).toHaveBeenCalledTimes(1)
    expect(drafts.cleared).toEqual(['/workflows', '/diff '])
  })

  it('leaves /diff and /workflows to be sent as typed when there is no sheet on screen to open', () => {
    publish = false
    render()
    expect(controller!.nativeChatAppCommand?.('/workflows')).toBe(false)
    expect(controller!.nativeChatAppCommand?.('/diff')).toBe(false)
    expect(drafts.cleared).toEqual([])
  })

  it('sends /model with a model named after it, and any other command, as before', () => {
    render()
    expect(controller!.nativeChatAppCommand?.('/model opus')).toBe(false)
    expect(controller!.nativeChatAppCommand?.('/compact')).toBe(false)
    expect(drafts.cleared).toEqual([])
  })

  it('does nothing of this before the tab is matched to its session', () => {
    api.gate = { kind: 'finding' }
    render()
    expect(controller!.nativeChatSessionCommands).toBeUndefined()
    expect(controller!.nativeChatAppCommand).toBeUndefined()
  })

  it('leaves a Codex tab exactly as it was: no session list, no app commands', () => {
    agent = 'codex'
    render()
    expect(controller!.nativeChatSessionCommands).toBeUndefined()
    expect(controller!.nativeChatAppCommand).toBeUndefined()
  })
})
