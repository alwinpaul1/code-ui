import { describe, expect, it, vi } from 'vitest'
import { formatEndpoint, testHostReachability, unreachableHostDetail } from './host-reachability'

describe('unreachableHostDetail', () => {
  it('points at Tailscale for tailnet CGNAT endpoints', () => {
    expect(unreachableHostDetail('ws://100.65.9.106:6768')).toBe(
      'Cannot reach 100.65.9.106:6768 — check Tailscale'
    )
  })

  it('points at Tailscale for MagicDNS endpoints', () => {
    expect(unreachableHostDetail('ws://my-desktop.tailnet-1234.ts.net:6768')).toBe(
      'Cannot reach my-desktop.tailnet-1234.ts.net:6768 — check Tailscale'
    )
  })

  it('stays generic for LAN endpoints', () => {
    expect(unreachableHostDetail('ws://192.168.1.50:6768')).toBe('Cannot reach 192.168.1.50:6768')
  })

  it('does not treat non-CGNAT 100.x addresses as Tailscale', () => {
    expect(unreachableHostDetail('ws://100.20.1.5:6768')).toBe('Cannot reach 100.20.1.5:6768')
  })

  // 2026-09-12: the phone sat on 192.168.1.143 with working internet while the
  // desk on 192.168.1.154 answered nothing, because Cisco Secure Client had
  // pushed 192.168.1.0/24 into its tunnel (Tunnel All Traffic, LocalLanAccess
  // false). Troubleshooting said only "Cannot reach 192.168.1.154:6768", so the
  // user went looking at the phone's Wi-Fi for an hour.
  it('names the desktop when an unreachable endpoint sits on the phone own subnet', () => {
    expect(unreachableHostDetail('ws://192.168.1.154:6768', '192.168.1.143')).toBe(
      'Cannot reach 192.168.1.154:6768 — the phone is on that network, so the desktop is dropping LAN traffic (a full-tunnel VPN or Wi-Fi client isolation)'
    )
  })

  it('stays generic when the phone is on a different subnet from the endpoint', () => {
    expect(unreachableHostDetail('ws://192.168.1.154:6768', '10.0.0.7')).toBe(
      'Cannot reach 192.168.1.154:6768'
    )
  })

  it('stays generic when the phone address is unknown', () => {
    expect(unreachableHostDetail('ws://192.168.1.154:6768', null)).toBe(
      'Cannot reach 192.168.1.154:6768'
    )
  })

  it('keeps the Tailscale hint even when a local address is known', () => {
    expect(unreachableHostDetail('ws://100.65.9.106:6768', '192.168.1.143')).toBe(
      'Cannot reach 100.65.9.106:6768 — check Tailscale'
    )
  })

  it('does not echo malformed endpoints that may contain credentials', () => {
    expect(formatEndpoint('not-a-url?token=secret')).toBe('invalid endpoint')
  })
})

describe('testHostReachability', () => {
  it('returns false without leaving timers when WebSocket rejects a malformed endpoint', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'WebSocket',
      class {
        constructor() {
          throw new TypeError('Invalid URL')
        }
      }
    )

    try {
      await expect(testHostReachability('not-a-url')).resolves.toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})
