import { describe, expect, it, vi } from 'vitest'

vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }))
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))

import { createHostClientSelectors } from '../transport/host-client-context-state'
import { HostClientOpenRegistry } from '../transport/host-client-open-registry'
import { clearLiveHostClientsForTest, publishLiveHostClient } from '../transport/live-host-clients'
import type { RpcClient } from '../transport/rpc-client'
import type { PhoneVpnStatus } from './phone-vpn-status'
import {
  phoneOnWifiFromNetworkType,
  readHostLiveConnection,
  troubleshootHostCheck
} from './troubleshoot-host-check'

const HOTSPOT_HOST = { name: 'Host 1', endpoint: 'ws://192.168.137.1:6768' }
const HOME_HOST = { name: 'Studio', endpoint: 'ws://192.168.1.20:6768' }
const VPN_ON: PhoneVpnStatus = {
  kind: 'known',
  active: true,
  carriesAppTraffic: true,
  routesEndpoint: null
}
const VPN_OFF: PhoneVpnStatus = {
  kind: 'known',
  active: false,
  carriesAppTraffic: false,
  routesEndpoint: null
}
const VPN_UNKNOWN: PhoneVpnStatus = { kind: 'unknown', reason: 'check unavailable on this build' }

const PHONE_VPN =
  'a VPN on this phone is routing local traffic away from your desktop; allow LAN access in the VPN app or pause it'
const WINDOWS_HOTSPOT =
  "192.168.137.x is Windows' Mobile Hotspot network, where Windows Firewall often treats the adapter as Public and blocks port 6768"

// 2026-09-27: Home said "Connected · Orca Relay" while Troubleshooting drew a red X over
// the same host, because the row judged a fresh LAN probe alone and ignored the live relay.
describe('the Troubleshooting host row', () => {
  it('warns, not fails, when the host is connected through the relay and only the direct path is down', () => {
    expect(
      troubleshootHostCheck({
        host: HOTSPOT_HOST,
        reachable: false,
        live: { state: 'connected', path: 'relay' },
        localAddress: '192.168.137.23',
        phoneVpn: VPN_ON
      })
    ).toEqual({
      label: 'Host 1',
      status: 'warn',
      detail: `Connected via Orca Relay · direct Wi-Fi path unavailable (${PHONE_VPN}). ${WINDOWS_HOTSPOT}`
    })
  })

  it('says only that the endpoint did not answer when nothing more is known', () => {
    expect(
      troubleshootHostCheck({
        host: HOME_HOST,
        reachable: false,
        live: { state: 'connected', path: 'relay' },
        localAddress: '10.0.0.7',
        phoneVpn: VPN_UNKNOWN
      })
    ).toEqual({
      label: 'Studio',
      status: 'warn',
      detail:
        'Connected via Orca Relay · direct Wi-Fi path unavailable (192.168.1.20:6768 did not answer)'
    })
  })

  it('names Tailscale, not Wi-Fi, for a tailnet endpoint behind a live relay', () => {
    expect(
      troubleshootHostCheck({
        host: { name: 'Tail', endpoint: 'ws://100.65.9.106:6768' },
        reachable: false,
        live: { state: 'connected', path: 'relay' },
        localAddress: null,
        phoneVpn: VPN_ON
      }).detail
    ).toBe('Connected via Orca Relay · direct Tailscale path unavailable (check Tailscale)')
  })

  it('warns when a live direct connection works but the fresh probe did not answer', () => {
    expect(
      troubleshootHostCheck({
        host: HOME_HOST,
        reachable: false,
        live: { state: 'connected', path: 'lan' },
        localAddress: '192.168.1.40',
        phoneVpn: VPN_OFF
      })
    ).toEqual({
      label: 'Studio',
      status: 'warn',
      detail: 'Connected via Direct · LAN · a fresh probe of 192.168.1.20:6768 did not answer'
    })
  })

  it('fails when there is no live client at all', () => {
    expect(
      troubleshootHostCheck({
        host: HOTSPOT_HOST,
        reachable: false,
        live: { state: null, path: 'lan' },
        localAddress: '192.168.137.23',
        phoneVpn: VPN_ON
      })
    ).toEqual({
      label: 'Host 1',
      status: 'fail',
      detail: `Cannot reach 192.168.137.1:6768 — ${PHONE_VPN}. ${WINDOWS_HOTSPOT}`
    })
  })

  it.each(['disconnected', 'reconnecting', 'connecting', 'handshaking', 'auth-failed'] as const)(
    'fails when the live client is %s, even on the relay path',
    (state) => {
      expect(
        troubleshootHostCheck({
          host: HOME_HOST,
          reachable: false,
          live: { state, path: 'relay' },
          localAddress: '192.168.1.40',
          phoneVpn: VPN_OFF
        }).status
      ).toBe('fail')
    }
  )

  it('passes when the probe answers, whatever the live client says', () => {
    for (const live of [
      { state: null, path: 'lan' as const },
      { state: 'connected' as const, path: 'relay' as const }
    ]) {
      expect(
        troubleshootHostCheck({
          host: HOME_HOST,
          reachable: true,
          live,
          localAddress: '192.168.1.40',
          phoneVpn: VPN_UNKNOWN
        })
      ).toEqual({ label: 'Studio', status: 'pass', detail: 'Reachable at 192.168.1.20:6768' })
    }
  })
})

// Review, 2026-09-27: after the screen tree was destroyed, the socket stays parked in the process.
// Its state was read from the parked client and its path from the (empty) store, so a relay
// session read "Connected via Direct · LAN".
describe("the host's live connection as Troubleshooting reads it", () => {
  const parkedOnRelay = {
    getState: () => 'connected',
    getActivePath: () => 'relay',
    getPendingPath: () => null
  } as unknown as RpcClient

  function contextWithEmptyStore() {
    return {
      ...createHostClientSelectors(new Map(), new HostClientOpenRegistry()),
      getAllClients: () => []
    }
  }

  it('reads the path of a parked relay client from the client, the same place as its state', () => {
    clearLiveHostClientsForTest()
    publishLiveHostClient('host-1', parkedOnRelay)

    expect(readHostLiveConnection(contextWithEmptyStore(), 'host-1')).toEqual({
      state: 'connected',
      path: 'relay'
    })
    clearLiveHostClientsForTest()
  })

  it('has no live connection when nothing is stored or parked', () => {
    clearLiveHostClientsForTest()

    expect(readHostLiveConnection(contextWithEmptyStore(), 'host-1')).toEqual({
      state: null,
      path: 'lan'
    })
  })
})

describe('whether the phone is on Wi-Fi, from its network type', () => {
  it.each([
    ['WIFI', true],
    ['ETHERNET', true],
    ['CELLULAR', false],
    ['NONE', false],
    ['VPN', null],
    ['UNKNOWN', null],
    [null, null]
  ] as const)('reads %s as %s', (type, onWifi) => {
    expect(phoneOnWifiFromNetworkType(type)).toBe(onWifi)
  })
})
