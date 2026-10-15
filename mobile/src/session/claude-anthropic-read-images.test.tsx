import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import type { ClaudeChatGate } from './use-claude-anthropic-transcript'
import type { MobileNativeChatSession } from './use-mobile-native-chat-session'

/**
 * The user's report of 2026-10-15: the contact sheet Claude Read (a .jpg) was drawn by the Claude app
 * under "Ran a command, read a file" and not by Code UI. The picture was on the phone: the link
 * kept it under the Read's call id the moment the event arrived (ccr-link-store.ts). What never
 * saw it was the slot: the hooks that place a Read's picture (use-host-image-previews.ts, which
 * turns a Read's path into a slot, and use-ccr-session-images.ts, which fills it) were handed
 * ORCA's rows while the chat drew Anthropic's, so every slot was keyed by an id no drawn row has
 * (the same defect as claude-anthropic-echo-rows.test.tsx, in a third consumer of the rows). This
 * pins that each picture hook is handed the DRAWN rows.
 */

const orca = { messages: [] as NativeChatMessage[], status: 'ready', transcriptLoading: false }
const api: { gate: ClaudeChatGate; session: MobileNativeChatSession | null; events: readonly never[] } = { gate: { kind: 'off' }, session: null, events: [] }
const previewArgs: { messages: readonly NativeChatMessage[] }[] = []
const ccrImageArgs: { messages: readonly NativeChatMessage[] }[] = []

vi.mock('../transport/client-context-connection-metrics', () => ({ useLastConnectedAt: () => null }))
vi.mock('./use-mobile-session-view-mode', () => ({ useMobileSessionViewMode: () => ({ isTabChatView: () => true, toggleTabChatView: vi.fn() }) }))
vi.mock('./use-mobile-native-chat-session', () => ({ useMobileNativeChatSession: () => orca }))
vi.mock('./use-claude-anthropic-transcript', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./use-claude-anthropic-transcript')>()),
  useClaudeAnthropicTranscript: () => api
}))
vi.mock('./use-host-image-previews', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./use-host-image-previews')>()),
  useHostImagePreviews: (args: (typeof previewArgs)[number]) => {
    previewArgs.push(args)
    return {}
  }
}))
vi.mock('./use-ccr-session-images', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./use-ccr-session-images')>()),
  useCcrSessionImages: (args: (typeof ccrImageArgs)[number]) => {
    ccrImageArgs.push(args)
    return { byToolUseId: {}, byUserMessageId: {} }
  }
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
vi.mock('./use-mobile-native-chat-outbox', () => ({ useMobileNativeChatOutbox: () => ({ deliveries: [], retry: vi.fn(), edit: vi.fn() }) }))
vi.mock('./use-mobile-native-chat-composer-catalogs', () => ({
  useMobileNativeChatComposerCatalogs: () => ({ nativeChatFilePaths: [], loadNativeChatFiles: vi.fn(), nativeChatSkills: [], loadNativeChatSkills: vi.fn() })
}))

import { useMobileNativeChatController } from './use-mobile-native-chat-controller'

const SESSION = 'session-1'
const readCall: NativeChatMessage = {
  id: 'a-read-sheet',
  role: 'assistant',
  blocks: [{ type: 'tool-call', name: 'Read', input: { file_path: '/private/tmp/scratchpad/rec3/sheet.jpg' }, callId: 'toolu_0171UAAbDtG6AKTpfE7hbR4s' }],
  timestamp: 1,
  source: 'transcript'
}
const orcaRead: NativeChatMessage = { ...readCall, id: 'orca-line-77' }

describe('the pictures a Claude tab drawn from Anthropic places', () => {
  let renderer: ReactTestRenderer | null = null
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
    useMobileNativeChatController({
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

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    api.gate = { kind: 'off' }
    api.session = null
    orca.messages = []
    previewArgs.length = 0
    ccrImageArgs.length = 0
  })

  const ids = (rows: readonly NativeChatMessage[] | undefined) => (rows ?? []).map((row) => row.id)

  it('hands the slot hooks the rows the chat draws, so a Read’s slot is keyed by a drawn row', () => {
    orca.messages = [orcaRead]
    api.gate = { kind: 'matched', accountId: 'acct', sessionId: SESSION }
    api.session = { messages: [readCall], status: 'ready', transcriptLoading: false, hasMore: false, loadingEarlier: false, loadEarlier: () => undefined }
    act(() => {
      renderer = create(createElement(Harness))
    })
    expect(ids(previewArgs.at(-1)?.messages)).toEqual(['a-read-sheet'])
    expect(ids(ccrImageArgs.at(-1)?.messages)).toEqual(['a-read-sheet'])
  })

  it('still hands them Orca’s rows on a tab the gate does not cover', () => {
    orca.messages = [orcaRead]
    act(() => {
      renderer = create(createElement(Harness))
    })
    expect(ids(previewArgs.at(-1)?.messages)).toEqual(['orca-line-77'])
    expect(ids(ccrImageArgs.at(-1)?.messages)).toEqual(['orca-line-77'])
  })

  it('hands them no rows while the tab is still being matched, not Orca’s', () => {
    orca.messages = [orcaRead]
    api.gate = { kind: 'finding' }
    api.session = { messages: [], status: 'loading', transcriptLoading: false, hasMore: false, loadingEarlier: false, loadEarlier: () => undefined }
    act(() => {
      renderer = create(createElement(Harness))
    })
    expect(ids(previewArgs.at(-1)?.messages)).toEqual([])
  })
})
