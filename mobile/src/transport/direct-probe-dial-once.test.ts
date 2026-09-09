import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connect } from './rpc-client'
import { openAuthenticatedDirectEndpoint } from './mobile-direct-endpoint-probe'
import type { ConnectionLogEntry, HostProfile } from './types'

// Read off a Galaxy S23's Connection log on 2026-09-09, 21.6 hours into a
// session riding the relay with both direct addresses unreachable:
//
//   +77894s  !  WebSocket closed            Close code 1006; reconnect scheduled
//   +77894s  •  Reconnect scheduled in 500ms   Attempt 1
//   +77894s  !  WebSocket closed            Close code 1006; reconnect scheduled
//   +77894s  •  Reconnect scheduled in 500ms   Attempt 1
//   +77894s  •  Reconnecting (attempt 2)    100.72.20.78:6768
//   +77894s  •  Reconnecting (attempt 2)    192.168.1.154:6768
//   +77965s  •  Opening WebSocket           192.168.1.154:6768
//   +77965s  •  Opening WebSocket           100.72.20.78:6768
//   +77975s  !  WebSocket closed            Close code 1006; reconnect scheduled
//   ...
//
// Those are the direct-return PROBES. A probe opens a full DirectRpcClient,
// which is built to keep a live connection alive: a socket that closes puts it
// in 'reconnecting' and arms the backoff ladder. But the probe only gives up on
// 'disconnected' | 'auth-failed', so a dead endpoint that refuses the socket in
// a second is never reported dead — the probe sits out its whole 12 s budget
// (6 s for the launch race) while the client dials again at 500 ms, 1 s, 2 s,
// 4 s, two log lines each, on every known address. The 200-entry log held about
// two minutes of this and nothing older, and the launch race against a dead
// direct address always ran to its stopwatch instead of ending at the refusal.

vi.mock('./e2ee', () => ({
  generateKeyPair: () => ({ publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) }),
  deriveSharedKey: () => new Uint8Array(32),
  publicKeyFromBase64: () => new Uint8Array(32),
  publicKeyToBase64: () => 'client-public-key',
  encrypt: (plaintext: string) => `encrypted:${plaintext}`,
  decrypt: (raw: string) => raw.replace(/^encrypted:/, ''),
  decryptBytes: (bytes: Uint8Array) => bytes
}))

vi.mock('./mobile-runtime-capability-negotiation', () => ({
  negotiateMobileRuntimeCapabilities: (args: { onReady: () => void }) => args.onReady()
}))

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readonly CONNECTING = 0
  readonly OPEN = 1

  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: ((event?: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event?: unknown) => void) | null = null

  constructor(readonly endpoint: string) {
    sockets.push(this)
  }

  send(): void {}

  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) {
      return
    }
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code: 1006, wasClean: false })
  }

  // The OS refused the TCP connect: the socket never opened and closes 1006.
  refuse(): void {
    this.close()
  }

  authenticate(): void {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
    this.onmessage?.({ data: JSON.stringify({ type: 'e2ee_ready' }) })
    this.onmessage?.({ data: 'encrypted:{"type":"e2ee_authenticated"}' })
  }
}

const sockets: MockWebSocket[] = []
const originalWebSocket = globalThis.WebSocket

const host: HostProfile = {
  id: 'host-1',
  name: 'Blue Whale',
  endpoint: 'ws://192.168.1.154:6768',
  deviceToken: 'device-token',
  publicKeyB64: 'A'.repeat(44),
  lastConnected: 1,
  endpoints: [
    { id: 'lan', kind: 'lan', url: 'ws://192.168.1.154:6768' },
    { id: 'tailscale', kind: 'tailscale', url: 'ws://100.72.20.78:6768' }
  ]
}

function socketsFor(endpoint: string): MockWebSocket[] {
  return sockets.filter((socket) => socket.endpoint.startsWith(endpoint))
}

describe('a direct probe dials once', () => {
  const log: ConnectionLogEntry[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    sockets.length = 0
    log.length = 0
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = originalWebSocket
  })

  const openDirect = (endpoint: string) =>
    connect(endpoint, host.deviceToken, host.publicKeyB64, {
      onLog: (entry) => log.push(entry),
      dialOnce: true
    })

  it('reports a refused endpoint dead at the refusal, not at the end of the budget', async () => {
    const probe = openAuthenticatedDirectEndpoint(host, openDirect, 12_000)
    await vi.advanceTimersByTimeAsync(10)
    expect(sockets).toHaveLength(2)

    // Both addresses refuse within the second, as they do on a network that
    // has neither of them.
    for (const socket of sockets) {
      socket.refuse()
    }
    let verdict: 'pending' | 'settled' = 'pending'
    void probe.then(() => (verdict = 'settled'))
    await vi.advanceTimersByTimeAsync(50)

    expect(verdict).toBe('settled')
    expect(await probe).toBeNull()
  })

  it('opens exactly one socket per address instead of walking the reconnect ladder', async () => {
    const probe = openAuthenticatedDirectEndpoint(host, openDirect, 12_000)
    await vi.advanceTimersByTimeAsync(10)
    for (const socket of sockets) {
      socket.refuse()
    }
    // Run out the whole budget the old probe would have sat through, plus the
    // ladder's first four steps (500 ms + 1 s + 2 s + 4 s), and check nothing
    // dialled again.
    await vi.advanceTimersByTimeAsync(12_000)
    await probe

    expect(socketsFor('ws://192.168.1.154')).toHaveLength(1)
    expect(socketsFor('ws://100.72.20.78')).toHaveLength(1)
  })

  it('leaves the connection log readable: the close, and no retry lines', async () => {
    const probe = openAuthenticatedDirectEndpoint(host, openDirect, 12_000)
    await vi.advanceTimersByTimeAsync(10)
    for (const socket of sockets) {
      socket.refuse()
    }
    await vi.advanceTimersByTimeAsync(12_000)
    await probe

    const codes = log.map((entry) => entry.code)
    expect(codes).not.toContain('retry-scheduled')
    expect(log.filter((entry) => entry.code === 'socket-closed')).toHaveLength(2)
    // The detail must not promise a retry that is not coming.
    for (const entry of log.filter((item) => item.code === 'socket-closed')) {
      expect(entry.detail).not.toMatch(/reconnect scheduled/)
    }
  })

  it('reconnects like a live client once the probe has won and been adopted', async () => {
    // The winning probe client is migrated in as the live direct connection,
    // so "dial once" has to mean "once to establish": after authentication a
    // dropped socket must reconnect exactly as it always has.
    const probe = openAuthenticatedDirectEndpoint(host, openDirect, 12_000)
    await vi.advanceTimersByTimeAsync(10)
    socketsFor('ws://192.168.1.154')[0]!.authenticate()
    await vi.advanceTimersByTimeAsync(10)
    const won = await probe
    expect(won?.endpoint).toBe('ws://192.168.1.154:6768')
    expect(won?.client.getState()).toBe('connected')

    const dialsBefore = socketsFor('ws://192.168.1.154').length
    socketsFor('ws://192.168.1.154')[0]!.close()
    expect(won?.client.getState()).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(600)
    expect(socketsFor('ws://192.168.1.154').length).toBe(dialsBefore + 1)
    won?.client.close()
  })
})
