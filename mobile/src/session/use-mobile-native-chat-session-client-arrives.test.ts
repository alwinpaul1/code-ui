import { resetNativeChatTranscriptCacheForTests } from './mobile-native-chat-transcript-cache'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileNativeChatSession } from './use-mobile-native-chat-session'

// Device log, 2026-10-17 (Code UI 0.9.160 local build, Orca relay): opening a worktree from the home
// screen logged one `[native-chat] subscribe … reason=client` 1.4 s after the route mounted. That
// reason reads like a client swapped under a running subscribe, which would be a wasted round trip.
// It is not: useHostClient returns null on the screen's first render (it acquires in an effect), so the
// first subscribe run has no client and sends nothing, and the run that does send is labelled `client`.
// This pins that the client arriving costs no second subscribe.

const SESSION = 'eeeeeeee-0000-4000-8000-000000000005'

describe('useMobileNativeChatSession: the host client arrives after the chat mounts', () => {
  let renderer: ReactTestRenderer | null = null
  let warn: { mock: { calls: unknown[][] }; mockRestore: () => void }
  const subscribe = vi.fn(() => () => {})
  const client = { sendRequest: vi.fn(), subscribe } as unknown as RpcClient

  beforeEach(() => {
    vi.useFakeTimers()
    subscribe.mockClear()
    resetNativeChatTranscriptCacheForTests()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    warn.mockRestore()
    vi.useRealTimers()
  })

  function Harness(props: { client: RpcClient | null }): null {
    useMobileNativeChatSession({
      client: props.client,
      sourceIdentity: 'host-a\0workspace-a',
      agent: 'claude',
      sessionId: SESSION,
      transcriptPath: null
    })
    return null
  }

  it('sends one subscribe when the client shows up a render after the chat, not one per client', async () => {
    await act(async () => {
      renderer = create(createElement(Harness, { client: null }))
    })
    expect(subscribe).not.toHaveBeenCalled()
    await act(async () => {
      renderer!.update(createElement(Harness, { client }))
    })
    expect(subscribe).toHaveBeenCalledTimes(1)
    // The same client on a later render (the background link handing a borrowed client back leaves
    // the host's one client in place) re-runs nothing.
    await act(async () => {
      renderer!.update(createElement(Harness, { client }))
    })
    expect(subscribe).toHaveBeenCalledTimes(1)
  })
})
