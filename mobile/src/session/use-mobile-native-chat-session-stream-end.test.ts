import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import { resetNativeChatTranscriptCacheForTests } from './mobile-native-chat-transcript-cache'
import {
  useMobileNativeChatSession,
  type MobileNativeChatSession
} from './use-mobile-native-chat-session'

function message(id: string): NativeChatMessage {
  return {
    id,
    role: 'assistant',
    blocks: [{ type: 'text', text: id }],
    timestamp: 1,
    source: 'transcript'
  }
}

type Feed = { token: string; emit: (frame: unknown) => void; open: boolean }

/** A desktop that keys chat feeds by the client's token: a second subscribe under a token already
 *  held ends the first feed, and an unsubscribe ends whatever holds the token. */
function fakeDesktop() {
  const feeds: Feed[] = []
  const unsubscribed: string[] = []
  const hold = (token: string) => feeds.find((feed) => feed.open && feed.token === token)
  const client = {
    sendRequest: vi.fn(),
    subscribe: vi.fn((_method: string, params: { subscriptionId: string }, onData) => {
      hold(params.subscriptionId)?.emit({ type: 'end' })
      const feed: Feed = { token: params.subscriptionId, emit: onData, open: true }
      for (const other of feeds) {
        if (other.token === feed.token) {
          other.open = false
        }
      }
      feeds.push(feed)
      return () => {
        unsubscribed.push(feed.token)
        hold(feed.token)?.emit({ type: 'end' })
        for (const other of feeds) {
          if (other.token === feed.token) {
            other.open = false
          }
        }
      }
    })
  }
  return {
    feeds,
    unsubscribed,
    client: client as unknown as RpcClient,
    subscribe: client.subscribe
  }
}

describe('native chat feed on the desktop', () => {
  const renderers: ReactTestRenderer[] = []
  const states = new Map<string, MobileNativeChatSession>()

  beforeEach(() => {
    states.clear()
    resetNativeChatTranscriptCacheForTests()
  })
  afterEach(() => {
    for (const renderer of renderers.splice(0)) {
      act(() => renderer.unmount())
    }
  })

  function Screen({ name, client }: { name: string; client: RpcClient }): null {
    states.set(
      name,
      useMobileNativeChatSession({
        client,
        sourceIdentity: 'host-a\0workspace-a',
        agent: 'claude',
        sessionId: 'session-1',
        transcriptPath: null
      })
    )
    return null
  }

  async function mountScreen(name: string, client: RpcClient): Promise<void> {
    await act(async () => {
      renderers.push(create(createElement(Screen, { name, client })))
    })
  }

  it('keeps two screens on one chat live: neither ends the other', async () => {
    const desktop = fakeDesktop()
    await mountScreen('below', desktop.client)
    await mountScreen('pushed', desktop.client)
    const [first, second] = desktop.feeds
    expect(first!.token).not.toBe(second!.token)
    act(() => first!.emit({ type: 'snapshot', messages: [message('a')], hasMore: false }))
    act(() => second!.emit({ type: 'snapshot', messages: [message('a')], hasMore: false }))
    expect(states.get('below')?.status).toBe('ready')
    expect(states.get('pushed')?.status).toBe('ready')
    expect(desktop.subscribe).toHaveBeenCalledTimes(2)
  })

  it('closing one of two screens on a chat names only its own feed', async () => {
    const desktop = fakeDesktop()
    await mountScreen('below', desktop.client)
    await mountScreen('pushed', desktop.client)
    act(() => renderers[1]!.unmount())
    renderers.pop()
    expect(desktop.unsubscribed).toEqual([desktop.feeds[1]!.token])
    expect(desktop.feeds[0]!.open).toBe(true)
  })

  it('names a chat feed by agent, session and a per-screen id', async () => {
    const desktop = fakeDesktop()
    await mountScreen('only', desktop.client)
    expect(desktop.feeds[0]!.token).toMatch(/^claude:session-1:.+/)
  })

  it('shows an error, not a live chat, when the feed ends without being closed', async () => {
    const desktop = fakeDesktop()
    await mountScreen('only', desktop.client)
    act(() =>
      desktop.feeds[0]!.emit({ type: 'snapshot', messages: [message('a')], hasMore: false })
    )
    expect(states.get('only')?.status).toBe('ready')
    act(() => desktop.feeds[0]!.emit({ type: 'end' }))
    expect(states.get('only')?.status).toBe('error')
    expect(states.get('only')?.messages.map((row) => row.id)).toEqual(['a'])
    expect(desktop.subscribe).toHaveBeenCalledTimes(1)
  })
})
