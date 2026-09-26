import { resetNativeChatTranscriptCacheForTests } from './mobile-native-chat-transcript-cache'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileNativeChatSession, type MobileNativeChatSession } from './use-mobile-native-chat-session'

// Split from use-mobile-native-chat-session.test.ts, which sits at its line
// cap; same harness.

function message(id: string): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text: id }], timestamp: 1, source: 'transcript' }
}

describe('useMobileNativeChatSession: a kept tail after an empty re-subscribe', () => {
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

  function Harness({ client }: { client: RpcClient | null }): null {
    state = useMobileNativeChatSession({
      client,
      sourceIdentity: 'host-a\0workspace-a',
      agent: 'claude',
      sessionId: 'session',
      transcriptPath: null
    })
    return null
  }

  async function mount(client: RpcClient): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Harness, { client }))
    })
  }

  it('says the shown transcript is the kept tail, with a gap before its live rows, until a real snapshot lands', async () => {
    // What was written while the tab was away is not in the kept tail, so the
    // running-task reader must not read the tail's reach as proof that the
    // lead launched nothing since (use-active-tab-task-report.ts, 2026-09-26).
    const subscribe: RpcClient['subscribe'] = vi.fn((_method, _params, onData) => {
      emit = onData
      return () => {}
    })
    const client = { sendRequest: vi.fn(), subscribe } as unknown as RpcClient
    await mount(client)
    act(() => emit({ type: 'snapshot', messages: [message('a'), message('b')], hasMore: false }))
    expect(state?.baseRetained).toBe(false)

    await act(async () => renderer?.update(createElement(Harness, { client: null })))
    await act(async () => renderer?.update(createElement(Harness, { client })))
    act(() => emit({ type: 'snapshot', messages: [], hasMore: false }))
    act(() => emit({ type: 'appended', messages: [message('c')] }))
    expect(state?.baseRetained).toBe(true)

    await act(async () => renderer?.update(createElement(Harness, { client: null })))
    await act(async () => renderer?.update(createElement(Harness, { client })))
    act(() => emit({ type: 'snapshot', messages: [message('a'), message('b'), message('c'), message('d')], hasMore: false }))
    expect(state?.baseRetained).toBe(false)
  })
})
