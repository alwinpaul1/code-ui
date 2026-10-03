import { describe, expect, it, vi } from 'vitest'
import { MobileRelayRpcStreams } from './mobile-relay-rpc-streams'
import { RpcClientStreamRegistry } from './rpc-client-stream-registry'

// `terminal:client` names a host slot, and it is the same for every re-subscribe. A goodbye that
// names only the slot ends whichever stream holds it NOW, so a stream closed after its replacement
// was sent ends the replacement. The host (Orca 1.4.218+) honours `requestId`, the id of the
// `terminal.subscribe` frame, and ignores a goodbye whose request is not the slot's current one.
// An older host (checked in v1.4.216/217: `TerminalUnsubscribe` is a plain `z.object`, parsed with
// `safeParse`) strips the field and falls back to the slot, which is today's behaviour.

type Frame = { id: string; method: string; params?: Record<string, unknown> }

const TERMINAL = { terminal: 'term-1', client: { id: 'phone-1' } }
const SLOT = 'term-1:phone-1'

/** The part of the host that decides who a goodbye ends. */
function fakeHost() {
  const holder = new Map<string, string>()
  return {
    holder,
    receive(frame: Frame) {
      if (frame.method === 'terminal.subscribe') {
        holder.set(SLOT, frame.id)
      } else if (frame.method === 'terminal.unsubscribe') {
        const requestId = frame.params?.requestId
        if (requestId === undefined || holder.get(SLOT) === requestId) {
          holder.delete(SLOT)
        }
      }
    }
  }
}

describe('terminal.unsubscribe names the request it ends: direct connection', () => {
  function direct() {
    const host = fakeHost()
    let id = 0
    const sent: Frame[] = []
    const registry = new RpcClientStreamRegistry({
      nextId: () => `rpc-${++id}`,
      deviceToken: 'device-token',
      getState: () => 'connected',
      sendEncrypted: (request) => {
        sent.push(request as Frame)
        host.receive(request as Frame)
        return true
      }
    })
    return { registry, host, sent }
  }

  it('does not end the newer feed when an older stream on the same slot closes late', () => {
    const { registry, host } = direct()
    const closeOlder = registry.subscribe('terminal.subscribe', TERMINAL, () => {})
    registry.subscribe('terminal.subscribe', TERMINAL, () => {})
    closeOlder()
    expect(host.holder.get(SLOT)).toBe('rpc-2')
  })

  it('still ends the feed when the stream that holds the slot closes', () => {
    const { registry, host } = direct()
    registry.subscribe('terminal.subscribe', TERMINAL, () => {})
    const closeNewer = registry.subscribe('terminal.subscribe', TERMINAL, () => {})
    closeNewer()
    expect(host.holder.has(SLOT)).toBe(false)
  })

  it('names the subscribe frame it ends in the goodbye', () => {
    const { registry, sent } = direct()
    const close = registry.subscribe('terminal.subscribe', TERMINAL, () => {})
    close()
    expect(sent.at(-1)).toMatchObject({
      method: 'terminal.unsubscribe',
      params: { subscriptionId: SLOT, client: { id: 'phone-1' }, requestId: 'rpc-1' }
    })
  })
})

describe('terminal.unsubscribe names the request it ends: relay connection', () => {
  function relay() {
    const host = fakeHost()
    let id = 0
    const sendFrame = vi.fn((request: Frame) => {
      host.receive(request)
      return true
    })
    const streams = new MobileRelayRpcStreams({
      nextId: () => `request-${++id}`,
      sendFrame,
      waitForConnected: async () => {}
    })
    return { streams, host, sendFrame }
  }

  it('names the subscribe frame it ends in the goodbye', async () => {
    const { streams, sendFrame } = relay()
    const close = streams.subscribe('terminal.subscribe', TERMINAL, vi.fn())
    await Promise.resolve()
    close()
    expect(sendFrame).toHaveBeenLastCalledWith({
      id: 'request-2',
      method: 'terminal.unsubscribe',
      params: { subscriptionId: SLOT, client: { id: 'phone-1' }, requestId: 'request-1' }
    })
  })

  it('does not end the newer feed when the stream that was replaced closes', async () => {
    const { streams, host } = relay()
    const closeOlder = streams.subscribe('terminal.subscribe', TERMINAL, vi.fn())
    streams.subscribe('terminal.subscribe', TERMINAL, vi.fn())
    await Promise.resolve()
    closeOlder()
    expect(host.holder.get(SLOT)).toBe('request-2')
  })

  it('still ends the feed when the stream that holds the slot closes', async () => {
    const { streams, host } = relay()
    streams.subscribe('terminal.subscribe', TERMINAL, vi.fn())
    const closeNewer = streams.subscribe('terminal.subscribe', TERMINAL, vi.fn())
    await Promise.resolve()
    closeNewer()
    expect(host.holder.has(SLOT)).toBe(false)
  })
})
