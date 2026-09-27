import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionLogEntry, ConnectionLogSink, HostProfile } from './types'

// A Pixel's diagnostics (2026-09-27) showed every connection event three
// times with different attempt counters, and nothing in the entries said they
// came from three clients for one desktop. Every entry a client writes now
// carries that client's generation: 1 for the first client for a host, 2 for
// the next, and so on.

const directSinks: ConnectionLogSink[] = []
const supervisorSinks: ConnectionLogSink[] = []

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('./rpc-client', () => ({
  connect: (_endpoint: string, _token: string, _key: string, options: { onLog: ConnectionLogSink }) => {
    directSinks.push(options.onLog)
    return {}
  }
}))
vi.mock('./stable-logical-rpc-client', () => ({
  createStableLogicalRpcClient: () => ({
    close: vi.fn(),
    notifyForeground: vi.fn(),
    setLivenessForeground: vi.fn()
  })
}))
vi.mock('./mobile-direct-endpoint-probe', () => ({ directPathForEndpoint: () => 'lan' }))
vi.mock('./mobile-endpoint-lifecycle', () => ({
  startMobileEndpointLifecycle: (_logical: unknown, _host: unknown, onLog: ConnectionLogSink) => {
    supervisorSinks.push(onLog)
    return { setForeground: vi.fn(), nudge: vi.fn(), stop: vi.fn() }
  }
}))

import { openHostLogicalClient } from './host-logical-client'

function host(id: string): HostProfile {
  return {
    id,
    name: id,
    endpoint: 'ws://192.168.137.1:6768',
    deviceToken: 'token',
    publicKeyB64: 'key',
    lastConnected: 0
  }
}

const socketClosed: ConnectionLogEntry = {
  id: 'log-1-1',
  ts: 1,
  level: 'warn',
  message: 'WebSocket closed',
  detail: 'Close code 1006; reconnect scheduled',
  code: 'socket-closed',
  path: 'lan'
}

const credentialUnavailable: ConnectionLogEntry = {
  id: 'relay-a-1',
  ts: 2,
  level: 'warn',
  path: 'relay',
  code: 'relay-credential-unavailable',
  message: 'Relay: relay credential expired; slow reprobe armed'
}

beforeEach(() => {
  directSinks.length = 0
  supervisorSinks.length = 0
})

describe('telling the clients for one desktop apart in its log', () => {
  it('stamps each client\'s entries with its generation for that host, from the socket and the relay supervisor alike', () => {
    const seen: ConnectionLogEntry[] = []
    const sink: ConnectionLogSink = (entry) => seen.push(entry)
    openHostLogicalClient(host('desktop-a'), sink)
    openHostLogicalClient(host('desktop-a'), sink, { backgroundLink: true })
    openHostLogicalClient(host('desktop-b'), sink)

    for (const write of directSinks) {
      write(socketClosed)
    }
    for (const write of supervisorSinks) {
      write(credentialUnavailable)
    }

    expect(seen.map((entry) => entry.clientGeneration)).toEqual([1, 2, 1, 1, 2, 1])
    // Only a field is added: the diagnostics screen reads the rest as before.
    expect(seen[0]).toEqual({ ...socketClosed, clientGeneration: 1 })
    expect(seen[4]).toEqual({ ...credentialUnavailable, clientGeneration: 2 })
  })
})
