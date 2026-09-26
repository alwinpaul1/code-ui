// Third verification of the line count (2026-09-26, failing on 046d383a and on
// c9480154): a created-file read issued while a LAN (direct) client is
// reconnecting. The direct client
// holds a request in waitForConnected (rpc-client-request-tracker.ts) and sends
// it on the NEW connection, so the host answers with the file as it is now,
// while the chat's window still lacks the call that appended to it while the
// phone was away (its row is in the replay, which has not landed).

import { resetNativeChatTranscriptCacheForTests } from './mobile-native-chat-transcript-cache'
import { createElement, useLayoutEffect, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  NativeChatToolCallBlock,
  NativeChatToolResultBlock
} from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import { RpcClientConnectionState } from '../transport/rpc-client-connection-state'
import { RpcClientRequestTracker } from '../transport/rpc-client-request-tracker'
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
const APPENDED = `${CREATED_FILE_ON_DISK}${'echo "appended by the agent"\n'.repeat(32)}`

/** A direct client's request path: while the socket is down, a request waits
 *  for the next connection and goes out on it, unless it asked to fail
 *  instead (rpc-client-request-tracker.ts). */
function heldHost(link: { up: boolean; waiters: (() => void)[] }, content: () => string) {
  return vi.fn(async (method: string, params?: unknown, options?: { failWhenDisconnected?: boolean }) => {
    if (!link.up && options?.failWhenDisconnected) {
      throw new Error(`Not connected: ${method}`)
    }
    if (!link.up) {
      await new Promise<void>((resolve) => link.waiters.push(resolve))
    }
    if (method === 'files.resolveTerminalPath') {
      const relativePath = (params as { pathText: string }).pathText.slice(WORKTREE_ROOT.length + 1)
      return {
        id: 'rpc',
        ok: true,
        result: { worktree: 'wt-1', exists: true, isDirectory: false, openTarget: { kind: 'worktree-file', relativePath } },
        _meta: { runtimeId: 'r' }
      }
    }
    return { id: 'rpc', ok: true, result: { content: content(), truncated: false }, _meta: { runtimeId: 'r' } }
  })
}

describe('a count read wanted while the LAN link is down', () => {
  let renderer: ReactTestRenderer | null = null
  let state: MobileNativeChatSession | null = null

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
    useLayoutEffect(() => {
      store.configure({ client: readClient as never, hostId: 'h', worktreeId: 'wt-1', lastConnectedAt })
    }, [store, readClient, lastConnectedAt])
    return (
      <CreatedFileCountProvider store={store} messages={state.messages} live={holdsWholeSession(state)}>
        {null}
      </CreatedFileCountProvider>
    )
  }

  const settle = async () => {
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
  }

  it.each([
    ['React renders the new connection before the held read is answered', true],
    ['the held read is answered before React renders the new connection', false]
  ])('draws no count from a read the phone asked for while the LAN was down (%s)', async (_case, renderFirst) => {
    let connectedAt = 1
    // What the file holds on the host: the create, and after the drop, 32 lines
    // a later call appended (its row is in the replay the host has not sent yet).
    let onDisk = CREATED_FILE_ON_DISK
    const link = { up: true, waiters: [] as (() => void)[] }
    const client = {
      getLastConnectedAt: () => connectedAt,
      sendRequest: vi.fn(),
      subscribe: vi.fn((_method, _params, onData) => {
        onData({ type: 'snapshot', messages: CLAUDE_EDIT_RUN_ROWS, hasMore: false, beforeOffset: 0 })
        return () => {}
      })
    } as unknown as RpcClient
    const store = createCreatedFileCountStore()
    const readClient = { sendRequest: heldHost(link, () => onDisk) }
    const props = { client, store, readClient }
    await act(async () => {
      renderer = create(createElement(Screen, { ...props, lastConnectedAt: 1 }))
    })
    expect(holdsWholeSession(state!)).toBe(true)
    // The Wi-Fi drops. The direct client is reconnecting; its stamp has not moved.
    link.up = false
    onDisk = `${CREATED_FILE_ON_DISK}${'echo "appended by the agent"\n'.repeat(32)}`
    // The user scrolls the create's run into view while the LAN is down.
    store.want(THE_CREATE)
    await settle()
    // The LAN comes back: a new connection, and the held request goes out on it.
    connectedAt = 2
    link.up = true
    if (renderFirst) {
      await act(async () => {
        renderer?.update(createElement(Screen, { ...props, lastConnectedAt: 2 }))
      })
    }
    for (const wake of link.waiters.splice(0)) {
      wake()
    }
    await settle()
    if (!renderFirst) {
      await act(async () => {
        renderer?.update(createElement(Screen, { ...props, lastConnectedAt: 2 }))
      })
    }
    await settle()
    // The replay has not landed: the window lacks the call that appended.
    expect(onDisk).toBe(APPENDED)
    // A read may go out; what it must not do is draw a count off this window.
    expect({
      count: store.countFor(THE_CREATE.key),
      reads: readClient.sendRequest.mock.calls.filter(([method]) => method === 'files.read').length
    }).toMatchObject({ count: null })
  })

  it('draws no count from a read the real direct-client request path held across a LAN reconnect', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    // The direct client's own connection state and request tracker
    // (direct-rpc-client.ts wires them the same way).
    const connection = new RpcClientConnectionState({
      endpoint: 'ws://192.168.1.10:6768',
      getReconnectAttempt: () => 0,
      isClosed: () => false
    })
    let onDisk = CREATED_FILE_ON_DISK
    let nextId = 0
    const tracker: RpcClientRequestTracker = new RpcClientRequestTracker({
      nextId: () => `req-${++nextId}`,
      deviceToken: 'device',
      getState: () => connection.get(),
      waitForConnected: (timeoutMs) => connection.waitForConnected(timeoutMs),
      sendEncrypted: (request) => {
        const { id, method, params } = request as { id: string; method: string; params: { pathText?: string } }
        // The host answers a beat later, reading the file as it is then.
        setTimeout(() => {
          const result =
            method === 'files.resolveTerminalPath'
              ? {
                  worktree: 'wt-1',
                  exists: true,
                  isDirectory: false,
                  openTarget: { kind: 'worktree-file', relativePath: params.pathText!.slice(WORKTREE_ROOT.length + 1) }
                }
              : { content: onDisk, truncated: false }
          tracker.resolve({ id, ok: true, result, _meta: { runtimeId: 'r' } } as never)
        }, 0)
        return true
      }
    })
    const readClient = { sendRequest: vi.fn((method: string, params?: unknown, options?: never) => tracker.sendRequest(method, params, options)) }
    connection.publish('connected')
    const first = connection.getLastConnectedAt()!
    const client = {
      getLastConnectedAt: () => connection.getLastConnectedAt(),
      sendRequest: vi.fn(),
      subscribe: vi.fn((_method, _params, onData) => {
        onData({ type: 'snapshot', messages: CLAUDE_EDIT_RUN_ROWS, hasMore: false, beforeOffset: 0 })
        return () => {}
      })
    } as unknown as RpcClient
    const store = createCreatedFileCountStore()
    const props = { client, store, readClient }
    await act(async () => {
      renderer = create(createElement(Screen, { ...props, lastConnectedAt: first }))
    })
    expect(holdsWholeSession(state!)).toBe(true)
    // The Wi-Fi drops (rpc-client-socket-close-controller: reconnecting).
    connection.publish('reconnecting')
    onDisk = APPENDED
    store.want(THE_CREATE)
    await settle()
    // The LAN comes back 5 ms later; the held request goes out on the new connection.
    await new Promise((resolve) => setTimeout(resolve, 5))
    connection.publish('connected')
    const second = connection.getLastConnectedAt()!
    expect(second).not.toBe(first)
    await act(async () => {
      renderer?.update(createElement(Screen, { ...props, lastConnectedAt: second }))
    })
    await settle()
    expect({
      count: store.countFor(THE_CREATE.key),
      reads: readClient.sendRequest.mock.calls.filter(([method]) => method === 'files.read').length
    }).toMatchObject({ count: null })
  })
})
