import { describe, expect, it } from 'vitest'
import { RpcClientStreamRegistry } from './rpc-client-stream-registry'
import { encodeTerminalStreamFrame, TerminalStreamOpcode } from './terminal-stream-protocol'
import type { ConnectionState, RpcResponse } from './types'

type SentRequest = {
  id: string
  method: string
  params?: unknown
}

function createRegistry(initialState: ConnectionState = 'connected') {
  const sent: SentRequest[] = []
  let state = initialState
  let id = 0
  const registry = new RpcClientStreamRegistry({
    nextId: () => `rpc-${++id}`,
    deviceToken: 'device-token',
    getState: () => state,
    sendEncrypted: (request) => {
      if (state !== 'connected') {
        return false
      }
      sent.push(request as SentRequest)
      return true
    }
  })
  return {
    registry,
    sent,
    setState(next: ConnectionState) {
      state = next
    }
  }
}

function streamingResponse(id: string, result: unknown): RpcResponse {
  return {
    id,
    ok: true,
    streaming: true,
    result,
    _meta: { runtimeId: 'runtime-1' }
  }
}

function terminalOutput(streamId: number, chunk: string): Uint8Array {
  return encodeTerminalStreamFrame({
    opcode: TerminalStreamOpcode.Output,
    streamId,
    seq: 1,
    payload: new TextEncoder().encode(chunk)
  })
}

describe('RpcClientStreamRegistry', () => {
  it('replays the latest terminal viewport without retaining stale stream routing', () => {
    const { registry, sent } = createRegistry()
    const events: unknown[] = []
    registry.subscribe(
      'terminal.subscribe',
      { terminal: 'term-1', viewport: { cols: 45, rows: 20 } },
      (event) => events.push(event)
    )
    const first = sent[0]!
    registry.handleResponse(streamingResponse(first.id, { type: 'subscribed', streamId: 7 }))
    registry.handleBinary(terminalOutput(7, 'before'))

    registry.updateTerminalViewport('term-1', { cols: 60, rows: 24 })
    registry.markForReplay()
    registry.replayAfterAuthentication()
    registry.handleBinary(terminalOutput(7, 'stale'))

    expect(sent[1]).toMatchObject({
      id: first.id,
      method: 'terminal.subscribe',
      params: { terminal: 'term-1', viewport: { cols: 60, rows: 24 } }
    })
    expect(events).toEqual([
      { type: 'subscribed', streamId: 7 },
      { type: 'data', streamId: 7, chunk: 'before' }
    ])
  })

  it('keeps a disposed browser tombstone until ready can be unsubscribed', () => {
    const { registry, sent } = createRegistry()
    const dispose = registry.subscribe('browser.screencast', { page: 'page-1' }, () => {})
    const request = sent[0]!

    dispose()
    expect(sent).toHaveLength(1)

    registry.handleResponse(
      streamingResponse(request.id, {
        type: 'ready',
        subscriptionId: 'browser-screencast:page-1:test'
      })
    )
    expect(sent[1]).toMatchObject({
      method: 'browser.screencast.unsubscribe',
      params: { subscriptionId: 'browser-screencast:page-1:test' }
    })
  })

  it.each([
    ['browser.screencast', 'browser.screencast.unsubscribe', { page: 'page-1' }],
    ['runtime.clientEvents.subscribe', 'runtime.clientEvents.unsubscribe', null],
    ['notifications.subscribe', 'notifications.unsubscribe', null],
    ['accounts.subscribe', 'accounts.unsubscribe', null]
  ])(
    'releases canceled %s callbacks while preserving late host cleanup',
    (method, cleanup, params) => {
      const { registry, sent } = createRegistry()
      const events: unknown[] = []
      const listener = (event: unknown) => events.push(event)
      const onBinaryFrame = () => events.push('binary')
      for (let index = 0; index < 64; index++) {
        registry.subscribe(method, params, listener, { onBinaryFrame })()
      }

      // Check the actual retaining roots: canceled starts can return without any reply.
      const registryState: unknown = registry
      if (
        typeof registryState !== 'object' ||
        registryState === null ||
        !('streams' in registryState)
      ) {
        throw new Error('Stream registry has no inspectable retaining map')
      }
      const streams = registryState.streams
      if (!(streams instanceof Map)) {
        throw new Error('Stream registry has no inspectable retaining map')
      }
      expect(streams.size).toBe(64)
      for (const entry of streams.values()) {
        const stream: unknown = entry
        if (
          typeof stream !== 'object' ||
          stream === null ||
          !('cancelled' in stream) ||
          !('listener' in stream) ||
          !('onBinaryFrame' in stream)
        ) {
          throw new Error('Stream registry has no inspectable retained callbacks')
        }
        expect(stream.cancelled).toBe(true)
        expect(stream.listener).toBeUndefined()
        expect(stream.onBinaryFrame).toBeUndefined()
      }

      const requests = [...sent]
      for (const request of requests) {
        registry.handleResponse(
          streamingResponse(request.id, { type: 'ready', subscriptionId: `host:${request.id}` })
        )
      }

      expect(events).toEqual([])
      expect(registry.size()).toBe(0)
      expect(
        sent.filter((request) => request.method === cleanup).map((request) => request.params)
      ).toEqual(requests.map((request) => ({ subscriptionId: `host:${request.id}` })))
    }
  )

  describe.each([
    ['browser.screencast', 'browser.screencast.unsubscribe', { page: 'page-1' }],
    ['runtime.clientEvents.subscribe', 'runtime.clientEvents.unsubscribe', null],
    ['notifications.subscribe', 'notifications.unsubscribe', null],
    ['accounts.subscribe', 'accounts.unsubscribe', null]
  ])('canceled %s delivery', (method, cleanup, params) => {
    it('ignores late scrollback and terminal registration while waiting for host cleanup', () => {
      const { registry, sent } = createRegistry()
      const events: unknown[] = []
      registry.subscribe(method, params, (event) => events.push(event))()
      const request = sent[0]!

      expect(
        registry.handleResponse({
          id: request.id,
          ok: true,
          result: { type: 'scrollback', serialized: 'late' }
        })
      ).toBe(true)
      registry.handleResponse(streamingResponse(request.id, { type: 'subscribed', streamId: 41 }))
      registry.handleBinary(terminalOutput(41, 'late'))
      expect(events).toEqual([])
      expect(registry.size()).toBe(1)
      expect(sent).toHaveLength(1)

      registry.handleResponse(
        streamingResponse(request.id, { type: 'ready', subscriptionId: 'late-host-id' })
      )
      expect(sent[1]).toMatchObject({
        method: cleanup,
        params: { subscriptionId: 'late-host-id' }
      })
      expect(registry.size()).toBe(0)
      expect(events).toEqual([])
    })

    it('does not replay a canceled opener queued before connection', () => {
      const { registry, sent, setState } = createRegistry('connecting')
      const events: unknown[] = []
      const dispose = registry.subscribe(method, params, (event) => events.push(event))

      dispose()
      dispose()
      registry.markForReplay()
      setState('connected')
      registry.replayAfterAuthentication()

      expect(sent).toEqual([])
      expect(events).toEqual([])
      expect(registry.size()).toBe(0)
    })
  })
})
