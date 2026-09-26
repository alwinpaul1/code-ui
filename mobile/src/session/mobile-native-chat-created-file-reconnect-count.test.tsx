// The chat hook and the created-file count store wired as
// MobileSessionActiveContent and MobileNativeChatOverlay wire them. Verification
// review of c9480154 (2026-09-26): a live row that landed after a new
// connection and before its replay opened the count on a window missing the
// row written while the phone was away, and it read +125 on the 93-line create.

import { resetNativeChatTranscriptCacheForTests } from './mobile-native-chat-transcript-cache'
import { createElement, useLayoutEffect, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  NativeChatMessage,
  NativeChatToolCallBlock,
  NativeChatToolResultBlock
} from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import { holdsWholeSession } from './mobile-native-chat-whole-session'
import { useMobileNativeChatSession, type MobileNativeChatSession } from './use-mobile-native-chat-session'
import { createCreatedFileCountStore, type CreatedFileCountStore } from './mobile-native-chat-created-file-count-store'
import { CreatedFileCountProvider } from './MobileNativeChatCreatedFileCounts'
import { cutCreateOf } from './mobile-native-chat-created-file-count'
import { CLAUDE_EDIT_RUN_ROWS, CREATED_A_FILE_RUN, CREATED_FILE_ON_DISK } from './fixtures/claude-edit-runs-2.1.282'

const WORKTREE_ROOT = '/Users/dev/Desktop/Project/Sample'
const THE_CREATE = cutCreateOf(
  CREATED_A_FILE_RUN[0] as NativeChatToolCallBlock,
  CREATED_A_FILE_RUN[1] as NativeChatToolResultBlock
)!

function host(content: string) {
  return vi.fn(async (method: string, params?: unknown) => {
    if (method === 'files.resolveTerminalPath') {
      const relativePath = (params as { pathText: string }).pathText.slice(WORKTREE_ROOT.length + 1)
      return {
        id: 'rpc',
        ok: true,
        result: { worktree: 'wt-1', exists: true, isDirectory: false, openTarget: { kind: 'worktree-file', relativePath } },
        _meta: { runtimeId: 'r' }
      }
    }
    return { id: 'rpc', ok: true, result: { content, truncated: false }, _meta: { runtimeId: 'r' } }
  })
}

/** While the phone was away, a later call appended 32 lines to the file. */
const APPENDED = `${CREATED_FILE_ON_DISK}${'echo "appended by the agent"\n'.repeat(32)}`

function text(id: string): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text: id }], timestamp: 1, source: 'transcript' }
}

describe('the created-file count after a reconnect', () => {
  let renderer: ReactTestRenderer | null = null
  let state: MobileNativeChatSession | null = null
  let emit: (frame: unknown) => void = () => {}

  beforeEach(() => {
    state = null
    resetNativeChatTranscriptCacheForTests()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function Screen({
    client,
    store,
    readClient,
    lastConnectedAt
  }: {
    client: RpcClient
    store: CreatedFileCountStore
    readClient: unknown
    lastConnectedAt: number
  }): ReactNode {
    state = useMobileNativeChatSession({
      client,
      sourceIdentity: 'host-a\0workspace-a',
      agent: 'claude',
      sessionId: 'session',
      transcriptPath: null,
      lastConnectedAt
    })
    // MobileSessionActiveContent: configure in a layout effect of the parent.
    useLayoutEffect(() => {
      store.configure({ client: readClient as never, hostId: 'h', worktreeId: 'wt-1', lastConnectedAt })
    }, [store, readClient, lastConnectedAt])
    return (
      <CreatedFileCountProvider store={store} messages={state.messages} live={holdsWholeSession(state)}>
        {null}
      </CreatedFileCountProvider>
    )
  }

  it('draws no count from a live row that landed before the replay of what was written while away', async () => {
    let connectedAt = 1
    const client = {
      getLastConnectedAt: () => connectedAt,
      sendRequest: vi.fn(),
      subscribe: vi.fn((_method, _params, onData) => {
        emit = onData
        onData({ type: 'snapshot', messages: CLAUDE_EDIT_RUN_ROWS, hasMore: false, beforeOffset: 0 })
        return () => {}
      })
    } as unknown as RpcClient
    const store = createCreatedFileCountStore()
    const readClient = { sendRequest: host(APPENDED) }
    const props = { client, store, readClient }
    await act(async () => {
      renderer = create(createElement(Screen, { ...props, lastConnectedAt: 1 }))
    })
    expect(holdsWholeSession(state!)).toBe(true)
    // The phone was away; a later call appended 32 lines to the created file
    // (its row is in the replay the host has not sent yet). New connection:
    connectedAt = 2
    await act(async () => {
      renderer?.update(createElement(Screen, { ...props, lastConnectedAt: 2 }))
    })
    // A live row lands before the replay.
    await act(async () => emit({ type: 'appended', messages: [text('live')] }))
    store.want(THE_CREATE)
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
    expect({
      count: store.countFor(THE_CREATE.key),
      reads: readClient.sendRequest.mock.calls.filter(([method]) => method === 'files.read').length
    }).toEqual({ count: null, reads: 0 })
  })
})
