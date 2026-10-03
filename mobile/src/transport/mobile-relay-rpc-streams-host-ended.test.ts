import { describe, expect, it, vi } from 'vitest'
import { MobileRelayRpcStreams } from './mobile-relay-rpc-streams'
import type { RpcResponse } from './types'

// Same defect as the direct client, on the relay: a closing screen names the host slot, so after
// the host ended a stream (or after a newer stream replaced it) that goodbye can end the live one.

type Frame = { id: string; method: string; params?: unknown }

function createStreams(waitForConnected: () => Promise<void> = async () => {}, sendOk = true) {
  let sequence = 0
  const sendFrame = vi.fn((request: Frame) => sendOk || request.method !== 'terminal.subscribe')
  const streams = new MobileRelayRpcStreams({
    nextId: () => `request-${++sequence}`,
    sendFrame,
    waitForConnected
  })
  return { streams, sendFrame }
}

function reply(id: string, result: unknown): RpcResponse {
  return { id, ok: true, streaming: true, result, _meta: { runtimeId: 'test' } } as RpcResponse
}

const unsubscribes = (sendFrame: ReturnType<typeof vi.fn>) =>
  sendFrame.mock.calls
    .map(([frame]) => frame as Frame)
    .filter((frame) => frame.method.endsWith('unsubscribe'))

const TERMINAL = { terminal: 'term-1', client: { id: 'phone-1' } }

function terminalThatClosesItselfOnEnd(streams: MobileRelayRpcStreams) {
  let close: () => void = () => {}
  close = streams.subscribe('terminal.subscribe', TERMINAL, (event) => {
    const type = (event as { type?: string }).type
    if (type === 'end' || type === 'error') {
      close()
    }
  })
}

describe('MobileRelayRpcStreams stream the host ended', () => {
  it('sends no terminal.unsubscribe when an end makes the screen close the stream', async () => {
    const { streams, sendFrame } = createStreams()
    terminalThatClosesItselfOnEnd(streams)
    await Promise.resolve()
    streams.handleResponse(reply('request-1', { type: 'end' }))
    expect(unsubscribes(sendFrame)).toEqual([])
  })

  it('sends no terminal.unsubscribe when an error reply makes the screen close the stream', async () => {
    const { streams, sendFrame } = createStreams()
    terminalThatClosesItselfOnEnd(streams)
    await Promise.resolve()
    streams.handleResponse({
      id: 'request-1',
      ok: false,
      error: { code: 'boom', message: 'nope' },
      _meta: { runtimeId: 'test' }
    } as RpcResponse)
    expect(unsubscribes(sendFrame)).toEqual([])
  })

  it('sends no terminal.unsubscribe when the subscribe frame cannot be sent', async () => {
    const { streams, sendFrame } = createStreams(async () => {}, false)
    terminalThatClosesItselfOnEnd(streams)
    await Promise.resolve()
    await Promise.resolve()
    expect(unsubscribes(sendFrame)).toEqual([])
  })

  it('tells the host when the newer of two streams on one terminal slot closes', async () => {
    const { streams, sendFrame } = createStreams()
    streams.subscribe('terminal.subscribe', TERMINAL, vi.fn())
    const closeNewer = streams.subscribe('terminal.subscribe', TERMINAL, vi.fn())
    await Promise.resolve()
    closeNewer()
    // The older stream was already replaced on the host, so only this goodbye can clear the slot.
    expect(unsubscribes(sendFrame)).toHaveLength(1)
  })

  it('stays quiet when the older of two streams on one terminal slot closes', async () => {
    const { streams, sendFrame } = createStreams()
    const closeOlder = streams.subscribe('terminal.subscribe', TERMINAL, vi.fn())
    streams.subscribe('terminal.subscribe', TERMINAL, vi.fn())
    await Promise.resolve()
    closeOlder()
    expect(unsubscribes(sendFrame)).toEqual([])
  })

  it('orders siblings by when they were sent, not when they were created', async () => {
    const gates: Array<() => void> = []
    const { streams, sendFrame } = createStreams(
      () => new Promise<void>((resolve) => gates.push(resolve))
    )
    const closeFirstCreated = streams.subscribe('terminal.subscribe', TERMINAL, vi.fn())
    streams.subscribe('terminal.subscribe', TERMINAL, vi.fn())
    // The second-created stream's connection wait settles first, so the first-created is sent last.
    gates[1]!()
    await Promise.resolve()
    await Promise.resolve()
    gates[0]!()
    await Promise.resolve()
    await Promise.resolve()
    closeFirstCreated()
    expect(unsubscribes(sendFrame)).toHaveLength(1)
  })
})
