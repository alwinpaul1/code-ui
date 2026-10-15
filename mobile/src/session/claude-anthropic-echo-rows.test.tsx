import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import type { ClaudeChatGate } from './use-claude-anthropic-transcript'
import type { MobileNativeChatSession } from './use-mobile-native-chat-session'

/**
 * A Claude tab matched to its Anthropic session draws Anthropic's rows, not Orca's
 * (use-claude-anthropic-transcript.ts). The phone's own send is drawn as a pending bubble until a
 * row claims it, and the drafts (pending bubbles) and the outbox (held sends) are what decide that
 * claim. Reported by review 2026-10-15: both were still fed Orca's rows, so the claim was made
 * against rows nobody drew:
 *  - Orca has the prompt, Anthropic not yet: the bubble was retired and nothing drew the message
 *    (and it stayed gone while the stream was reconnecting, lost, or in error);
 *  - Anthropic has it first: the bubble stayed beside Anthropic's row, the message drawn twice.
 * The claim is made in the drafts' own logic (settleLandedOwnSends), which this file does not
 * re-test; what it pins is that every echo-retiring consumer is handed the DRAWN rows.
 */

const orca = { messages: [] as NativeChatMessage[], status: 'ready', transcriptLoading: false }
const api: { gate: ClaudeChatGate; session: MobileNativeChatSession | null } = { gate: { kind: 'off' }, session: null }
const draftsArgs: { messages: readonly NativeChatMessage[]; transcriptSettled: boolean; transcriptLoading?: boolean }[] = []
const outboxArgs: { messages: readonly NativeChatMessage[]; transcriptSettled: boolean }[] = []

vi.mock('../transport/client-context-connection-metrics', () => ({ useLastConnectedAt: () => null }))
vi.mock('./use-mobile-session-view-mode', () => ({ useMobileSessionViewMode: () => ({ isTabChatView: () => true, toggleTabChatView: vi.fn() }) }))
vi.mock('./use-mobile-native-chat-session', () => ({ useMobileNativeChatSession: () => orca }))
vi.mock('./use-claude-anthropic-transcript', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./use-claude-anthropic-transcript')>()),
  useClaudeAnthropicTranscript: () => api
}))
vi.mock('./use-mobile-native-chat-drafts', () => ({
  useMobileNativeChatDrafts: (args: (typeof draftsArgs)[number]) => {
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
vi.mock('./use-mobile-native-chat-outbox', () => ({
  useMobileNativeChatOutbox: (args: (typeof outboxArgs)[number]) => {
    outboxArgs.push(args)
    return { deliveries: [], retry: vi.fn(), edit: vi.fn() }
  }
}))
vi.mock('./use-mobile-native-chat-composer-catalogs', () => ({
  useMobileNativeChatComposerCatalogs: () => ({ nativeChatFilePaths: [], loadNativeChatFiles: vi.fn(), nativeChatSkills: [], loadNativeChatSkills: vi.fn() })
}))

import { useMobileNativeChatController, type MobileNativeChatController } from './use-mobile-native-chat-controller'

const SESSION = 'session-1'
const TEXT = 'rename the helper and run the tests'
const reply = (id: string): NativeChatMessage => ({ id, role: 'assistant', blocks: [{ type: 'text', text: 'Done.' }], timestamp: 1, source: 'transcript' })
const prompt = (id: string): NativeChatMessage => ({ id, role: 'user', blocks: [{ type: 'text', text: TEXT }], timestamp: 2, source: 'transcript' })
const trouble: NativeChatMessage = { id: `ccr-link-trouble:${SESSION}`, role: 'system', blocks: [{ type: 'text', text: 'Lost the connection to Anthropic.', tone: 'warning' }], timestamp: null, source: 'transcript' }

function apiSession(messages: NativeChatMessage[], status: MobileNativeChatSession['status'] = 'ready'): MobileNativeChatSession {
  return { messages, status, transcriptLoading: false, hasMore: false, loadingEarlier: false, loadEarlier: () => undefined }
}

describe('a phone-sent prompt on a Claude tab drawn from Anthropic', () => {
  let renderer: ReactTestRenderer | null = null
  let controller: MobileNativeChatController | null = null
  const clientStub = { sendRequest: vi.fn(), getState: () => 'connected' as const, getLastConnectedAt: () => 1, notifyForeground: vi.fn() }
  const tab = {
    type: 'terminal',
    id: 'tab-1',
    terminal: 'term-1',
    launchAgent: 'claude',
    isActive: true,
    agentStatus: { state: 'idle', updatedAt: 1, agentType: 'claude', providerSession: { id: SESSION, transcriptPath: `/Users/me/.claude/projects/-Users-me-p/${SESSION}.jsonl` } }
  }

  function Harness(): null {
    controller = useMobileNativeChatController({
      client: clientStub as unknown as RpcClient,
      connState: 'connected',
      tabsLive: true,
      hostId: 'h',
      worktreeId: 'w',
      activeSessionTab: tab as never,
      activeSessionTabId: 'tab-1',
      activeHandleRef: { current: 'term-1' },
      deviceTokenRef: { current: null },
      nativeChatTranscriptIsLocalReadable: true,
      nativeChatInputLeaseReady: true,
      onSendError: vi.fn(),
      onSendResolved: vi.fn()
    })
    return null
  }

  function render(): void {
    act(() => {
      if (renderer) {
        renderer.update(createElement(Harness))
      } else {
        renderer = create(createElement(Harness))
      }
    })
  }

  /** The rows the chat draws, and the rows each echo-retiring consumer was last given. */
  function seen(): { drawn: string[]; drafts: string[]; outbox: string[] } {
    const ids = (rows: readonly NativeChatMessage[] | undefined) => (rows ?? []).map((row) => row.id)
    return { drawn: ids(controller?.nativeChatSession.messages), drafts: ids(draftsArgs.at(-1)?.messages), outbox: ids(outboxArgs.at(-1)?.messages) }
  }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    controller = null
    api.gate = { kind: 'off' }
    api.session = null
    orca.messages = []
    draftsArgs.length = 0
    outboxArgs.length = 0
  })

  const matched: ClaudeChatGate = { kind: 'matched', accountId: 'acct', sessionId: SESSION }

  it('keeps the bubble while Orca has the prompt and Anthropic does not yet', () => {
    orca.messages = [reply('r1'), prompt('orca-u1')]
    api.gate = matched
    api.session = apiSession([reply('r1')])
    render()
    // Handed Orca's rows, the drafts would see the prompt land and retire a bubble nothing draws.
    expect(seen()).toEqual({ drawn: ['r1'], drafts: ['r1'], outbox: ['r1'] })
  })

  it('draws the prompt once when Anthropic has it before Orca', () => {
    orca.messages = [reply('r1')]
    api.gate = matched
    api.session = apiSession([reply('r1'), prompt('api-u1')])
    render()
    expect(seen()).toEqual({ drawn: ['r1', 'api-u1'], drafts: ['r1', 'api-u1'], outbox: ['r1', 'api-u1'] })
  })

  it('keeps the bubble while the stream is lost and Orca already has the prompt', () => {
    orca.messages = [reply('r1'), prompt('orca-u1')]
    api.gate = matched
    api.session = apiSession([reply('r1'), trouble])
    render()
    expect(seen()).toEqual({ drawn: ['r1', trouble.id], drafts: ['r1', trouble.id], outbox: ['r1', trouble.id] })
  })

  it('does not count Orca rows as settled history while the tab is still being matched', () => {
    orca.messages = [reply('r1'), prompt('orca-u1')]
    api.gate = { kind: 'finding' }
    api.session = apiSession([], 'loading')
    render()
    expect(seen()).toEqual({ drawn: [], drafts: [], outbox: [] })
    expect(draftsArgs.at(-1)?.transcriptSettled).toBe(false)
    expect(outboxArgs.at(-1)?.transcriptSettled).toBe(false)
  })

  it('does not judge a bubble or a prefill against a link that failed before reading any row', () => {
    orca.messages = [reply('r1'), prompt('orca-u1')]
    api.gate = matched
    api.session = { ...apiSession([], 'error'), error: 'Anthropic could not be read: 500' }
    render()
    expect(seen()).toEqual({ drawn: [], drafts: [], outbox: [] })
    expect(draftsArgs.at(-1)).toMatchObject({ transcriptLoading: true, transcriptSettled: false })
  })

  it('treats a new session with no message yet as settled and empty', () => {
    api.gate = { kind: 'new' }
    api.session = apiSession([])
    render()
    expect(draftsArgs.at(-1)).toMatchObject({ messages: [], transcriptLoading: false, transcriptSettled: true })
  })

  it('still hands Orca rows to the drafts on a tab the gate does not cover', () => {
    orca.messages = [reply('r1'), prompt('orca-u1')]
    render()
    expect(seen()).toEqual({ drawn: ['r1', 'orca-u1'], drafts: ['r1', 'orca-u1'], outbox: ['r1', 'orca-u1'] })
  })
})
