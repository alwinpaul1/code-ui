import { describe, expect, it } from 'vitest'
import { RpcClientStreamRegistry } from './rpc-client-stream-registry'
import type { RpcResponse } from './types'

// A host that ended a stream has already dropped its registration. The phone's own goodbye then
// names the host slot (`terminal:client` is the same for every re-subscribe), so it can end the
// FRESH stream that replaced the old one. Every case below closes the stream from inside its own
// listener, which is what the terminal screen does the moment it sees `end` or `error`.

type Sent = { id: string; method: string; params?: unknown }

function createRegistry() {
  const sent: Sent[] = []
  let id = 0
  const registry = new RpcClientStreamRegistry({
    nextId: () => `rpc-${++id}`,
    deviceToken: 'device-token',
    getState: () => 'connected',
    sendEncrypted: (request) => {
      const frame = request as Sent
      sent.push(frame)
      return true
    }
  })
  return { registry, sent }
}

function reply(id: string, result: unknown, streaming: boolean): RpcResponse {
  return { id, ok: true, streaming, result, _meta: { runtimeId: 'runtime-1' } } as RpcResponse
}

function openTerminalThatClosesItselfOnEnd(registry: RpcClientStreamRegistry) {
  const seen: unknown[] = []
  let close: () => void = () => {}
  close = registry.subscribe(
    'terminal.subscribe',
    { terminal: 'term-1', client: { id: 'phone-1' } },
    (event) => {
      seen.push(event)
      const type = (event as { type?: string }).type
      if (type === 'end' || type === 'error') {
        close()
      }
    }
  )
  return seen
}

const unsubscribes = (sent: Sent[]) => sent.filter((frame) => frame.method.endsWith('unsubscribe'))

describe('RpcClientStreamRegistry stream the host ended', () => {
  it('sends no terminal.unsubscribe when a final end reply makes the screen close the stream', () => {
    const { registry, sent } = createRegistry()
    const seen = openTerminalThatClosesItselfOnEnd(registry)
    registry.handleResponse(reply('rpc-1', { type: 'end' }, false))
    expect(seen).toEqual([{ type: 'end' }])
    expect(unsubscribes(sent)).toEqual([])
    expect(registry.size()).toBe(0)
  })

  it('sends no terminal.unsubscribe when a streamed end makes the screen close the stream', () => {
    const { registry, sent } = createRegistry()
    openTerminalThatClosesItselfOnEnd(registry)
    registry.handleResponse(reply('rpc-1', { type: 'subscribed', streamId: 7 }, true))
    registry.handleResponse(reply('rpc-1', { type: 'end' }, true))
    expect(unsubscribes(sent)).toEqual([])
    expect(registry.size()).toBe(0)
  })

  it('sends no terminal.unsubscribe when an error reply makes the screen close the stream', () => {
    const { registry, sent } = createRegistry()
    openTerminalThatClosesItselfOnEnd(registry)
    registry.handleResponse({
      id: 'rpc-1',
      ok: false,
      error: { code: 'boom', message: 'nope' },
      _meta: { runtimeId: 'runtime-1' }
    } as RpcResponse)
    expect(unsubscribes(sent)).toEqual([])
    expect(registry.size()).toBe(0)
  })

  it('does not resend the subscribe of a stream the host ended when the connection comes back', () => {
    const { registry, sent } = createRegistry()
    registry.subscribe('terminal.subscribe', { terminal: 'term-1' }, () => {})
    registry.handleResponse(reply('rpc-1', { type: 'subscribed', streamId: 7 }, true))
    registry.handleResponse(reply('rpc-1', { type: 'end' }, true))
    registry.markForReplay()
    registry.replayAfterAuthentication()
    expect(sent.filter((frame) => frame.method === 'terminal.subscribe')).toHaveLength(1)
  })

  it('still tells the host when the screen closes a live stream itself', () => {
    const { registry, sent } = createRegistry()
    const close = registry.subscribe('terminal.subscribe', { terminal: 'term-1' }, () => {})
    registry.handleResponse(reply('rpc-1', { type: 'subscribed', streamId: 7 }, true))
    close()
    expect(unsubscribes(sent)).toEqual([
      expect.objectContaining({
        method: 'terminal.unsubscribe',
        params: { subscriptionId: 'term-1' }
      })
    ])
  })
})
