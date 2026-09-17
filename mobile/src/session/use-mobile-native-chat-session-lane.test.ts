import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeNativeChatTranscriptIdentity } from '../../../src/shared/native-chat-transcript-retention'

const lastConnectedAtCalls: (string | undefined)[] = []
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: (hostId: string | undefined) => {
    lastConnectedAtCalls.push(hostId)
    return null
  }
}))
vi.mock('./use-mobile-native-chat-session', () => ({
  useMobileNativeChatSession: () => ({ messages: [], status: 'idle' })
}))
vi.mock('./use-mobile-structured-agent-session', () => ({
  useMobileStructuredAgentSession: () => ({ session: { messages: [], status: 'idle' } })
}))

const { useMobileNativeChatSessionLane } = await import('./use-mobile-native-chat-session-lane')

/** The reconnect refetch only runs when `lastConnectedAt` moves, and that value
 *  only moves if the host id handed to `useLastConnectedAt` is a real host id.
 *
 *  Shipped broken once: the lane assumed `sourceIdentity` was `hostId` + NUL +
 *  `workspaceId` and split on NUL. The only producer is
 *  `encodeNativeChatTranscriptIdentity`, which is `JSON.stringify(parts)` — no
 *  NUL — so the split returned the whole JSON string, no host ever matched, and
 *  the fix was inert while the release notes claimed it worked. The unit test
 *  passed because it fed the hook the invented NUL string instead of the real
 *  encoder's output. This one uses the encoder. */
describe('the chat lane asks about the host it is actually connected to', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    lastConnectedAtCalls.length = 0
  })

  function Harness({ sourceIdentity }: { sourceIdentity: string }): null {
    useMobileNativeChatSessionLane({
      client: null,
      structured: false,
      agent: null,
      resolvedAgent: 'claude',
      transcriptPath: null,
      sessionId: 'session-1',
      sourceIdentity,
      enabled: true,
      connState: 'connected',
      onSendError: vi.fn()
    })
    return null
  }

  it('passes the host id, not the encoded identity, to the connection clock', async () => {
    const sourceIdentity = encodeNativeChatTranscriptIdentity(['host-1', 'wt-1'])
    await act(async () => {
      renderer = create(createElement(Harness, { sourceIdentity }))
    })
    expect(lastConnectedAtCalls).toContain('host-1')
    expect(lastConnectedAtCalls).not.toContain(sourceIdentity)
  })
})
