import { describe, expect, it } from 'vitest'
import { MobileRelayRpcStreams } from './mobile-relay-rpc-streams'
import { RpcClientStreamRegistry } from './rpc-client-stream-registry'
import { buildStreamUnsubscribe } from './rpc-client-terminal-subscription'

type SentFrame = { id: string; method: string; params?: unknown }

const SUBSCRIBE_PARAMS = { sessionId: 'session-1' }

// Orca #22835: the host keys each structured-chat transcript stream by the frame id that opened it,
// so a close that sends nothing leaves the host feeding a phone that stopped listening, and one
// that omits the id ends every stream of the session on the socket.
describe('closing a structured chat stream', () => {
  it('names the session and the request that opened it', () => {
    expect(buildStreamUnsubscribe('agentSession.subscribe', SUBSCRIBE_PARAMS, 'rpc-7')).toEqual({
      method: 'agentSession.unsubscribe',
      params: { sessionId: 'session-1', subscriptionId: 'rpc-7' }
    })
  })

  it('sends nothing it cannot name', () => {
    expect(buildStreamUnsubscribe('agentSession.subscribe', {}, 'rpc-7')).toBeNull()
    expect(buildStreamUnsubscribe('agentSession.subscribe', SUBSCRIBE_PARAMS)).toBeNull()
  })

  it('tells the host on the direct connection', () => {
    const sent: SentFrame[] = []
    let id = 0
    const registry = new RpcClientStreamRegistry({
      nextId: () => `rpc-${++id}`,
      deviceToken: 'device-token',
      getState: () => 'connected',
      sendEncrypted: (request) => {
        sent.push(request as SentFrame)
        return true
      }
    })
    const close = registry.subscribe('agentSession.subscribe', SUBSCRIBE_PARAMS, () => {})
    const opener = sent[0]!
    close()
    expect(sent.slice(1).map(({ method, params }) => ({ method, params }))).toEqual([
      {
        method: 'agentSession.unsubscribe',
        params: { sessionId: 'session-1', subscriptionId: opener.id }
      }
    ])
  })

  it('tells the host on the relay', async () => {
    const sent: SentFrame[] = []
    let id = 0
    const streams = new MobileRelayRpcStreams({
      nextId: () => `relay-${++id}`,
      sendFrame: (frame) => {
        sent.push(frame as SentFrame)
        return true
      },
      waitForConnected: async () => {}
    })
    const close = streams.subscribe('agentSession.subscribe', SUBSCRIBE_PARAMS, () => {})
    await Promise.resolve()
    const opener = sent[0]!
    close()
    expect(sent.slice(1).map(({ method, params }) => ({ method, params }))).toEqual([
      {
        method: 'agentSession.unsubscribe',
        params: { sessionId: 'session-1', subscriptionId: opener.id }
      }
    ])
  })
})
