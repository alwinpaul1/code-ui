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

// 2026-09-27, a friend's Pixel: a VPN key in the status bar, the phone on
// 192.168.137.x (the desktop's own Windows hotspot), and Troubleshooting said
// "the desktop is dropping LAN traffic". The phone's VPN was the first suspect,
// and the app could not see it: expo-network reports WIFI before VPN.
const PHONE_VPN =
  'a VPN on this phone is routing local traffic away from your desktop; allow LAN access in the VPN app or pause it'
const WINDOWS_HOTSPOT =
  "192.168.137.x is Windows' Mobile Hotspot network, where Windows Firewall often treats the adapter as Public and blocks port 6768"

describe('unreachableHostDetail with a VPN on the phone', () => {
  it('names the phone VPN, not the desktop, when the phone is on the endpoint network', () => {
    expect(
      unreachableHostDetail('ws://192.168.1.154:6768', '192.168.1.143', { phoneVpnActive: true })
    ).toBe(`Cannot reach 192.168.1.154:6768 — ${PHONE_VPN}`)
  })

  it('names the phone VPN on Wi-Fi even when the phone address is unreadable', () => {
    expect(
      unreachableHostDetail('ws://192.168.1.154:6768', null, {
        phoneVpnActive: true,
        phoneOnWifi: true
      })
    ).toBe(`Cannot reach 192.168.1.154:6768 — ${PHONE_VPN}`)
  })

  // Review, 2026-09-27: the phone's address is WifiInfo.ipAddress, which is 0.0.0.0 (read as
  // unknown) off Wi-Fi, so an always-on VPN on mobile data was told to allow LAN access. Pausing
  // it cannot bring a LAN into reach from mobile data.
  it('does not blame the phone VPN on mobile data', () => {
    expect(
      unreachableHostDetail('ws://192.168.1.154:6768', null, {
        phoneVpnActive: true,
        phoneVpnRoutesEndpoint: true,
        phoneOnWifi: false
      })
    ).toBe('Cannot reach 192.168.1.154:6768')
    // With no network type either, no Wi-Fi address means no Wi-Fi.
    expect(unreachableHostDetail('ws://192.168.1.154:6768', null, { phoneVpnActive: true })).toBe(
      'Cannot reach 192.168.1.154:6768'
    )
  })

  it('does not blame the phone VPN when the phone is plainly on another network', () => {
    expect(
      unreachableHostDetail('ws://192.168.1.154:6768', '10.0.0.7', {
        phoneVpnActive: true,
        phoneVpnRoutesEndpoint: true
      })
    ).toBe('Cannot reach 192.168.1.154:6768')
  })

  it('names the phone VPN when its routes are known to cover the endpoint', () => {
    expect(
      unreachableHostDetail('ws://192.168.1.154:6768', '192.168.1.143', {
        phoneVpnActive: true,
        phoneVpnRoutesEndpoint: true
      })
    ).toBe(`Cannot reach 192.168.1.154:6768 — ${PHONE_VPN}`)
  })

  it('does not blame a VPN whose routes leave the endpoint on the local network, and still not the desktop by that phrase', () => {
    const detail = unreachableHostDetail('ws://192.168.1.154:6768', '192.168.1.143', {
      phoneVpnActive: true,
      phoneVpnRoutesEndpoint: false
    })
    expect(detail).toBe(
      "Cannot reach 192.168.1.154:6768 — the phone is on that network and its VPN leaves local traffic alone; check the desktop's firewall and any VPN there, and Wi-Fi client isolation"
    )
    expect(detail).not.toContain('routing local traffic away')
    expect(detail).not.toContain('the desktop is dropping LAN traffic')
  })

  it('keeps the desktop copy when the phone is known to have no VPN', () => {
    expect(
      unreachableHostDetail('ws://192.168.1.154:6768', '192.168.1.143', { phoneVpnActive: false })
    ).toBe(
      'Cannot reach 192.168.1.154:6768 — the phone is on that network, so the desktop is dropping LAN traffic (a full-tunnel VPN or Wi-Fi client isolation)'
    )
  })

  it('keeps the old copy when the VPN check could not answer', () => {
    expect(
      unreachableHostDetail('ws://192.168.1.154:6768', '192.168.1.143', {
        phoneVpnActive: null,
        phoneVpnRoutesEndpoint: null
      })
    ).toBe(
      'Cannot reach 192.168.1.154:6768 — the phone is on that network, so the desktop is dropping LAN traffic (a full-tunnel VPN or Wi-Fi client isolation)'
    )
    expect(unreachableHostDetail('ws://192.168.1.50:6768', null, {})).toBe(
      'Cannot reach 192.168.1.50:6768'
    )
  })

  it('keeps the Tailscale hint when a phone VPN is up, since Tailscale is one', () => {
    expect(
      unreachableHostDetail('ws://100.65.9.106:6768', '192.168.1.143', { phoneVpnActive: true })
    ).toBe('Cannot reach 100.65.9.106:6768 — check Tailscale')
  })
})

describe('unreachableHostDetail on a Windows Mobile Hotspot address', () => {
  it('reads the reported screen: the phone VPN first, then the hotspot firewall hint', () => {
    expect(
      unreachableHostDetail('ws://192.168.137.1:6768', '192.168.137.23', { phoneVpnActive: true })
    ).toBe(`Cannot reach 192.168.137.1:6768 — ${PHONE_VPN}. ${WINDOWS_HOTSPOT}`)
  })

  it('adds the hotspot hint with no VPN on the phone', () => {
    expect(
      unreachableHostDetail('ws://192.168.137.1:6768', '192.168.137.23', { phoneVpnActive: false })
    ).toBe(
      `Cannot reach 192.168.137.1:6768 — the phone is on that network, so the desktop is dropping LAN traffic (a full-tunnel VPN or Wi-Fi client isolation). ${WINDOWS_HOTSPOT}`
    )
  })

  it('adds the hotspot hint when nothing else is known', () => {
    expect(unreachableHostDetail('ws://192.168.137.1:6768')).toBe(
      `Cannot reach 192.168.137.1:6768. ${WINDOWS_HOTSPOT}`
    )
  })

  it('names the port the endpoint actually uses', () => {
    expect(unreachableHostDetail('ws://192.168.137.1:7001')).toBe(
      "Cannot reach 192.168.137.1:7001. 192.168.137.x is Windows' Mobile Hotspot network, where Windows Firewall often treats the adapter as Public and blocks port 7001"
    )
  })

  it('names the scheme default port for an endpoint that states none', () => {
    expect(unreachableHostDetail('ws://192.168.137.1')).toMatch(/blocks port 80$/)
    expect(unreachableHostDetail('wss://192.168.137.1')).toMatch(/blocks port 443$/)
  })

  it('adds no hotspot hint on other private networks', () => {
    for (const endpoint of [
      'ws://192.168.1.137:6768',
      'ws://192.168.13.7:6768',
      'ws://10.192.168.137:6768',
      'ws://192.168.138.1:6768'
    ]) {
      expect(unreachableHostDetail(endpoint)).not.toContain('Mobile Hotspot')
    }
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
