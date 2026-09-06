import { describe, expect, it } from 'vitest'
import {
  directEndpointKind,
  directEndpointUrls,
  withDirectEndpoint,
  withPreferredDirectEndpoint
} from './mobile-direct-endpoint-list'
import type { HostProfile } from './types'

const base: HostProfile = {
  id: 'h',
  name: 'Mac',
  endpoint: 'ws://100.72.20.78:6768',
  deviceToken: 't',
  publicKeyB64: 'A'.repeat(44),
  lastConnected: 1,
  endpoints: [
    { id: 'direct-primary', kind: 'lan', url: 'ws://100.72.20.78:6768' },
    { id: 'relay-primary', kind: 'relay', url: 'wss://c1.relay.onorca.dev/v1/connect/x' }
  ],
  directUnreachableSince: 5
}

describe('direct endpoint list', () => {
  it('classifies Tailscale literals and names, everything else as LAN', () => {
    expect(directEndpointKind('ws://100.72.20.78:6768')).toBe('tailscale')
    expect(directEndpointKind('wss://mac.tail1234.ts.net:6768')).toBe('tailscale')
    expect(directEndpointKind('ws://192.168.1.154:6768')).toBe('lan')
    expect(directEndpointKind('not a url')).toBe('lan')
  })

  it('adds an address without dropping the primary or the relay', () => {
    const next = withDirectEndpoint(base.endpoints, base.endpoint, 'ws://192.168.1.154:6768')
    expect(next.map((entry) => [entry.id, entry.kind, entry.url])).toEqual([
      ['direct-primary', 'lan', 'ws://100.72.20.78:6768'],
      ['relay-primary', 'relay', 'wss://c1.relay.onorca.dev/v1/connect/x'],
      ['direct-lan', 'lan', 'ws://192.168.1.154:6768']
    ])
    // Idempotent on origin, whatever the path suffix.
    expect(withDirectEndpoint(next, base.endpoint, 'ws://192.168.1.154:6768/rpc')).toEqual(next)
  })

  it('builds a list for a profile that never had one', () => {
    expect(withDirectEndpoint(undefined, 'ws://192.168.1.10:6768', 'ws://100.1.2.3:6768')).toEqual([
      { id: 'direct-primary', kind: 'lan', url: 'ws://192.168.1.10:6768' },
      { id: 'direct-tailscale', kind: 'tailscale', url: 'ws://100.1.2.3:6768' }
    ])
  })

  it('prefers the winner, keeps the old primary, and clears the dead verdict', () => {
    const next = withPreferredDirectEndpoint(base, 'ws://192.168.1.154:6768')
    expect(next?.endpoint).toBe('ws://192.168.1.154:6768')
    expect(next?.directUnreachableSince).toBeUndefined()
    expect(directEndpointUrls(next!)).toEqual(['ws://192.168.1.154:6768', 'ws://100.72.20.78:6768'])
    expect(withPreferredDirectEndpoint(base, 'ws://100.72.20.78:6768/x')).toBeNull()
  })
})
