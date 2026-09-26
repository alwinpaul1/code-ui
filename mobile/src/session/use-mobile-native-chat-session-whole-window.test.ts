// The created-file count is read only while the chat holds the whole session
// from its first row (holdsWholeSession). Re-review of c914027d (2026-09-26):
// read off `hasMore`, that opened at the 2000-row paging cap (+125 on a
// 93-line create), on a first window of a host that omits `hasMore`, and on
// rows appended before the snapshot; and making a live trim set `hasMore`
// brought "Load earlier" back with a growing-tail read that dropped 50 shown
// rows. `wholeSession` is its own flag now, set only by the host's word.

import { resetNativeChatTranscriptCacheForTests } from './mobile-native-chat-transcript-cache'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import { holdsWholeSession } from './mobile-native-chat-whole-session'
import { useMobileNativeChatSession, type MobileNativeChatSession } from './use-mobile-native-chat-session'

function message(id: string): NativeChatMessage {
  return {
    id,
    role: 'assistant',
    blocks: [{ type: 'text', text: id }],
    timestamp: 1,
    source: 'transcript'
  }
}

function countGateOpen(session: MobileNativeChatSession | null): boolean {
  return session !== null && holdsWholeSession(session)
}

describe('when the chat holds the whole session', () => {
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
    vi.useRealTimers()
  })

  function Harness({ client, lastConnectedAt = 1 }: { client: RpcClient | null; lastConnectedAt?: number }): null {
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

  async function mount(client: RpcClient): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Harness, { client }))
    })
  }

  async function loadEarlier(): Promise<void> {
    await act(async () => {
      state?.loadEarlier()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it('does not read a window paged to the 2000-row cap of a longer session as the whole session', async () => {
    // The host always has older rows: every page says hasMore true.
    let offset = 10_000_000
    const sendRequest = vi.fn(async (_method: string, params: { limit: number }) => {
      offset -= 10_000
      return {
        ok: true,
        result: {
          messages: Array.from({ length: params.limit }, (_unused, index) =>
            message(`page-${offset}-${index}`)
          ),
          hasMore: true,
          beforeOffset: offset
        }
      }
    })
    const subscribe: RpcClient['subscribe'] = vi.fn((_method, _params, onData) => {
      emit = onData
      onData({
        type: 'snapshot',
        messages: Array.from({ length: 40 }, (_unused, index) => message(`tail-${index}`)),
        hasMore: true,
        beforeOffset: offset
      })
      return () => {}
    })
    await mount({ sendRequest, subscribe } as unknown as RpcClient)
    for (let page = 0; page < 33; page += 1) {
      await loadEarlier()
    }
    expect(sendRequest.mock.calls.length).toBe(33)
    expect(sendRequest.mock.results.at(-1)?.type).toBe('return')
    // Every page said older rows exist; the window is not the whole session.
    expect({ rows: state?.messages.length, gateOpen: countGateOpen(state) }).toEqual({
      rows: 2000,
      gateOpen: false
    })
  })

  it('keeps every row already shown, and stops counting, when a live trim cuts a session that opened whole', async () => {
    // The host's transcript: 151 rows. The chat opened on the first 3 (whole),
    // then a long turn appended the other 148, and the window trimmed at 150.
    const transcript = Array.from({ length: 151 }, (_unused, index) => message(`row-${index}`))
    const sendRequest = vi.fn(async (_method: string, params: { limit: number; beforeOffset?: number }) => {
      // Older runtimes / an invalidated cursor: the growing tail of `limit`.
      const tail = transcript.slice(-params.limit)
      return { ok: true, result: { messages: tail, hasMore: transcript.length > params.limit } }
    })
    const subscribe: RpcClient['subscribe'] = vi.fn((_method, _params, onData) => {
      emit = onData
      onData({ type: 'snapshot', messages: transcript.slice(0, 3), hasMore: false, beforeOffset: 0 })
      return () => {}
    })
    await mount({ sendRequest, subscribe } as unknown as RpcClient)
    await act(async () => emit({ type: 'appended', messages: transcript.slice(3) }))
    const shown = state?.messages.map((entry) => entry.id) ?? []
    expect(shown.length).toBe(150)
    expect(countGateOpen(state)).toBe(false)

    await loadEarlier()

    const after = new Set(state?.messages.map((entry) => entry.id))
    expect(shown.filter((id) => !after.has(id))).toEqual([])
  })

  it('does not read a 12-row first window from a host that omits hasMore as the whole session', async () => {
    vi.useFakeTimers()
    const limits: number[] = []
    const subscribe: RpcClient['subscribe'] = vi.fn((_method, params, onData) => {
      const { limit } = params as { limit: number }
      limits.push(limit)
      emit = onData
      if (limit === 12) {
        // Filled to the limit asked for: older rows may exist. No hasMore on
        // the frame, as the hook's `?? messages.length >= INITIAL_LIMIT`
        // fallback allows for.
        onData({
          type: 'snapshot',
          messages: Array.from({ length: 12 }, (_unused, index) => message(`tail-${index}`))
        })
      }
      return () => {}
    })
    await mount({ sendRequest: vi.fn(), subscribe } as unknown as RpcClient)
    // The first subscribe (limit 40) never answers; the watchdog retries at 12.
    await act(async () => {
      vi.advanceTimersByTime(20_000)
    })
    expect(limits).toEqual([40, 12])
    expect({ rows: state?.messages.length, gateOpen: countGateOpen(state) }).toEqual({
      rows: 12,
      gateOpen: false
    })
  })
  it('does not read live rows that landed before the base snapshot as the whole session', async () => {
    // use-mobile-native-chat-session.test.ts already allows an append to land
    // before the snapshot ("keeps the base snapshot authoritative when a live
    // append arrives first"). Until the snapshot comes, the window is only the
    // session's newest rows.
    const subscribe: RpcClient['subscribe'] = vi.fn((_method, _params, onData) => {
      emit = onData
      return () => {}
    })
    await mount({ sendRequest: vi.fn(), subscribe } as unknown as RpcClient)
    await act(async () => emit({ type: 'appended', messages: [message('newest-a'), message('newest-b')] }))
    expect({ rows: state?.messages.length, gateOpen: countGateOpen(state) }).toEqual({
      rows: 2,
      gateOpen: false
    })
  })

  it('counts from a window the host says starts at the first row, and from a page that reaches it', async () => {
    const sendRequest = vi.fn(async () => ({
      ok: true,
      result: { messages: [message('first'), message('second')], hasMore: false, beforeOffset: 0 }
    }))
    const subscribe: RpcClient['subscribe'] = vi.fn((_method, _params, onData) => {
      emit = onData
      onData({ type: 'snapshot', messages: [message('only')], hasMore: false, beforeOffset: 0 })
      return () => {}
    })
    await mount({ sendRequest, subscribe } as unknown as RpcClient)
    expect(countGateOpen(state)).toBe(true)
    act(() => renderer?.unmount())
    renderer = null

    const paged: RpcClient['subscribe'] = vi.fn((_method, _params, onData) => {
      emit = onData
      onData({ type: 'snapshot', messages: [message('tail')], hasMore: true, beforeOffset: 10 })
      return () => {}
    })
    await mount({ sendRequest, subscribe: paged } as unknown as RpcClient)
    expect(countGateOpen(state)).toBe(false)
    await loadEarlier()
    expect(countGateOpen(state)).toBe(true)
  })

  // Review of c6d8394a (2026-09-26): a healthy reconnect replays the
  // transcript on the same subscription, and a "Load earlier" page answered
  // before that replay said the window reached the first row: the count was
  // read from a transcript still missing the edit made while the phone was
  // away (+94 on the 93-line create).
  it('does not count from a page answered after a reconnect, before its replay lands', async () => {
    const client = {
      sendRequest: vi.fn(async () => ({
        ok: true,
        result: { messages: [message('older')], hasMore: false, beforeOffset: 0 }
      })),
      subscribe: vi.fn((_method, _params, onData) => {
        emit = onData
        onData({ type: 'snapshot', messages: [message('tail')], hasMore: true, beforeOffset: 10 })
        return () => {}
      })
    } as unknown as RpcClient
    await mount(client)
    await act(async () => {
      renderer?.update(createElement(Harness, { client, lastConnectedAt: 2 }))
    })
    await loadEarlier()
    expect({ rows: state?.messages.map((entry) => entry.id), gateOpen: countGateOpen(state) }).toEqual({
      rows: ['older', 'tail'],
      gateOpen: false
    })
    await act(async () =>
      emit({ type: 'snapshot', messages: [message('older'), message('tail'), message('away')], hasMore: false, beforeOffset: 0 })
    )
    expect({ rows: state?.messages.map((entry) => entry.id), gateOpen: countGateOpen(state) }).toEqual({
      rows: ['older', 'tail', 'away'],
      gateOpen: true
    })
  })
})
