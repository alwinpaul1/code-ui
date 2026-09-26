// The created-file count after a reconnect. Verification review of c9480154
// (2026-09-26), each case failing there: a live row that landed before the
// replay opened the count on a window still missing what was written while
// the phone was away (+125 on the 93-line create, the end-to-end case in
// mobile-native-chat-created-file-reconnect-count.test.tsx); two connections
// before one replay, and a replay that came before React rendered the new
// connection, shut it for the rest of the visit; and a replacement during
// the wait opened it on a window that starts later.

import { resetNativeChatTranscriptCacheForTests } from './mobile-native-chat-transcript-cache'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import { holdsWholeSession } from './mobile-native-chat-whole-session'
import { useMobileNativeChatSession, type MobileNativeChatSession } from './use-mobile-native-chat-session'

function message(id: string): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text: id }], timestamp: 1, source: 'transcript' }
}

const TAIL = Array.from({ length: 40 }, (_unused, index) => message(`tail-${index}`))
const OLDER = Array.from({ length: 20 }, (_unused, index) => message(`older-${index}`))
const SHORT = [message('first'), message('second'), message('third')]

describe('the count across a reconnect', () => {
  let renderer: ReactTestRenderer | null = null
  let state: MobileNativeChatSession | null = null
  let emit: (frame: unknown) => void = () => {}
  // What the client says of its connection, as the transport does before the
  // replay on it arrives; React renders it a beat later.
  let connectedAt = 1

  beforeEach(() => {
    state = null
    connectedAt = 1
    resetNativeChatTranscriptCacheForTests()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function Harness({ client, lastConnectedAt }: { client: RpcClient; lastConnectedAt: number }): null {
    state = useMobileNativeChatSession({
      client,
      sourceIdentity: 'host-a\0workspace-a',
      agent: 'claude',
      sessionId: 'session',
      transcriptPath: null,
      lastConnectedAt
    })
    return null
  }

  function hostOf(first: readonly NativeChatMessage[], hasMore: boolean): RpcClient {
    return {
      getLastConnectedAt: () => connectedAt,
      sendRequest: vi.fn(async () => ({ ok: true, result: { messages: OLDER, hasMore: false, beforeOffset: 0 } })),
      subscribe: vi.fn((_method, _params, onData) => {
        emit = onData
        onData({ type: 'snapshot', messages: first, hasMore, beforeOffset: hasMore ? 10 : 0 })
        return () => {}
      })
    } as unknown as RpcClient
  }

  async function mount(client: RpcClient): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Harness, { client, lastConnectedAt: connectedAt }))
    })
  }

  /** The transport's new connection, then React's render of it. */
  async function reconnect(client: RpcClient, at: number): Promise<void> {
    connectedAt = at
    await act(async () => {
      renderer?.update(createElement(Harness, { client, lastConnectedAt: at }))
    })
  }

  async function loadEarlier(): Promise<void> {
    await act(async () => {
      state?.loadEarlier()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  const replay = () => act(async () => emit({ type: 'snapshot', messages: TAIL, hasMore: true, beforeOffset: 10 }))
  const view = () => ({ first: state?.messages[0]?.id, rows: state?.messages.length, hasMore: state?.hasMore, gateOpen: countGateOpen(state) })
  const WHOLE_AGAIN = { first: 'older-0', rows: 60, hasMore: false, gateOpen: true }

  it('keeps the count shut when a live row lands before the replay of a short session', async () => {
    const client = hostOf(SHORT, false)
    await mount(client)
    expect(countGateOpen(state)).toBe(true)
    await reconnect(client, 2)
    await act(async () => emit({ type: 'appended', messages: [message('live')] }))
    expect({ rows: state?.messages.map((entry) => entry.id), gateOpen: countGateOpen(state) }).toEqual({
      rows: ['first', 'second', 'third', 'live'],
      gateOpen: false
    })
  })

  it('keeps the count shut when a live row lands before the replay of a chat paged to its first row', async () => {
    const client = hostOf(TAIL, true)
    await mount(client)
    await loadEarlier()
    expect(countGateOpen(state)).toBe(true)
    await reconnect(client, 2)
    await act(async () => emit({ type: 'appended', messages: [message('live')] }))
    expect({ rows: state?.messages.length, gateOpen: countGateOpen(state) }).toEqual({ rows: 61, gateOpen: false })
  })

  it('opens the count again when a connection drops before its replay and the next one replays', async () => {
    const client = hostOf(TAIL, true)
    await mount(client)
    await loadEarlier()
    await reconnect(client, 2)
    await reconnect(client, 3)
    await replay()
    expect(view()).toEqual(WHOLE_AGAIN)
  })

  it('opens the count again when a page reached the first row between two connections', async () => {
    const client = hostOf(TAIL, true)
    await mount(client)
    await reconnect(client, 2)
    await loadEarlier()
    await reconnect(client, 3)
    await replay()
    expect(view()).toEqual(WHOLE_AGAIN)
  })

  it('opens the count again when the replay lands before the new connection renders, with no row after it', async () => {
    const client = hostOf(TAIL, true)
    await mount(client)
    await loadEarlier()
    connectedAt = 2
    await replay()
    await reconnect(client, 2)
    await reconnect(client, 2)
    expect(view()).toEqual(WHOLE_AGAIN)
    // And a later reconnect in the usual order still reopens it.
    await reconnect(client, 3)
    await replay()
    expect(view()).toEqual(WHOLE_AGAIN)
  })

  it('keeps the count shut on a replacement during the wait that starts after the first row', async () => {
    const client = hostOf(TAIL, true)
    await mount(client)
    await loadEarlier()
    await reconnect(client, 2)
    const REWRITTEN = Array.from({ length: 40 }, (_unused, index) => message(`rewritten-${index}`))
    await act(async () => emit({ type: 'replacement', messages: REWRITTEN, hasMore: true, beforeOffset: 900 }))
    await act(async () => emit({ type: 'appended', messages: [message('live')] }))
    expect({ first: state?.messages[0]?.id, gateOpen: countGateOpen(state) }).toEqual({ first: 'rewritten-0', gateOpen: false })
    // A replay after it is judged on its own window, not the one before the connection.
    await replay()
    expect(countGateOpen(state)).toBe(false)
  })
})

function countGateOpen(session: MobileNativeChatSession | null): boolean {
  return session !== null && holdsWholeSession(session)
}
