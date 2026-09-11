import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { directEndpointsPlausibleOnNetwork } from './mobile-direct-endpoint-list'
import { DirectReturnProbe } from './mobile-direct-return-probe'
import { MobileEndpointHysteresis } from './mobile-endpoint-hysteresis'
import type { HostProfile } from './types'

// Read off a Galaxy S23 on 2026-09-09: while the phone rode the relay it
// re-dialled 192.168.1.154:6768 and 100.72.20.78:6768 every probe cycle and
// each socket hung the full 12 s connect timeout. On cellular a private LAN
// address can never answer, so dialing it is pure radio and battery.
describe('direct endpoints plausible on the current network', () => {
  const lan = 'ws://192.168.1.154:6768'
  const lanTen = 'ws://10.0.0.5:6768'
  const linkLocal = 'ws://169.254.3.4:6768'
  const mdns = 'ws://studio.local:6768'
  const tailscaleIp = 'ws://100.72.20.78:6768'
  const tailscaleName = 'wss://studio.tail1234.ts.net:6768'
  const publicName = 'wss://desk.example.com:6768'

  it('drops private-LAN addresses on cellular and keeps Tailscale and public ones', () => {
    expect(
      directEndpointsPlausibleOnNetwork(
        [lan, lanTen, linkLocal, mdns, tailscaleIp, tailscaleName, publicName],
        'CELLULAR'
      )
    ).toEqual([tailscaleIp, tailscaleName, publicName])
  })

  it('keeps everything on Wi-Fi, Ethernet, or when the network type is unknown', () => {
    const all = [lan, tailscaleIp, publicName]
    expect(directEndpointsPlausibleOnNetwork(all, 'WIFI')).toEqual(all)
    expect(directEndpointsPlausibleOnNetwork(all, 'ETHERNET')).toEqual(all)
    expect(directEndpointsPlausibleOnNetwork(all, 'UNKNOWN')).toEqual(all)
    expect(directEndpointsPlausibleOnNetwork(all, null)).toEqual(all)
  })
})

describe('direct-return probe on cellular', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const host: HostProfile = {
    id: 'host-1',
    name: 'Studio',
    endpoint: 'ws://192.168.1.154:6768',
    deviceToken: 'device-token',
    publicKeyB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
  } as HostProfile

  it('dials nothing for a LAN-only host, records no failure, and re-checks later', async () => {
    const openDirect = vi.fn()
    const hysteresis = new MobileEndpointHysteresis(Date.now(), {
      directSuccessesRequired: 3,
      directObservationMs: 30_000,
      failureCooldownMs: 60_000,
      minimumDwellMs: 60_000,
      maxFailureCooldownMs: 600_000
    })
    const onDirectUnreachable = vi.fn()
    const probe = new DirectReturnProbe(
      {
        now: Date.now,
        setTimer: setTimeout,
        clearTimer: clearTimeout,
        openDirect,
        networkType: async () => 'CELLULAR'
      },
      {
        hysteresis,
        host: () => host,
        canSchedule: () => true,
        canAttempt: () => true,
        beginOperation: () => {},
        migrate: async () => {},
        onDirectMigrated: async () => {},
        onDirectUnreachable,
        afterProbe: () => {}
      }
    )

    probe.schedule(0)
    await vi.advanceTimersByTimeAsync(1)

    expect(openDirect).not.toHaveBeenCalled()
    expect(onDirectUnreachable).not.toHaveBeenCalled()
    // Nothing was proven about the endpoint, so the cooldown ladder must not move.
    expect(hysteresis.canProbe(Date.now())).toBe(true)
    probe.clear()
  })
})

describe('a direct path already proven dead on this network', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /** Measured on a Galaxy S23 behind a full-tunnel VPN: both direct endpoints
   *  (LAN and Tailscale) were re-dialled on every cooldown and on every
   *  foreground return, two sockets held for the OS's 10 s connect timeout,
   *  every minute, all night — while nothing about the network had changed.
   *  The verdict was remembered; what was missing was WHERE it was reached. */
  const deadHere: HostProfile = {
    id: 'host-1',
    name: 'Studio',
    endpoint: 'ws://192.168.1.154:6768',
    deviceToken: 'device-token',
    publicKeyB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    // A verdict reached just now: fresh enough to stand (it expires after
    // DIRECT_VERDICT_TTL_MS).
    directUnreachableSince: Date.now(),
    directUnreachableNetwork: 'WIFI|192.168.1.143'
  } as HostProfile

  function probeOn(identity: string, host: HostProfile) {
    // A client that never authenticates: the probe must wait on it, not throw.
    const openDirect = vi.fn(
      () =>
        ({
          getState: () => 'connecting',
          onStateChange: () => () => {},
          close: () => {}
        }) as unknown as ReturnType<typeof openDirect>
    )
    const hysteresis = new MobileEndpointHysteresis(Date.now(), {
      directSuccessesRequired: 3,
      directObservationMs: 30_000,
      failureCooldownMs: 60_000,
      minimumDwellMs: 60_000,
      maxFailureCooldownMs: 600_000
    })
    const probe = new DirectReturnProbe(
      {
        now: Date.now,
        setTimer: setTimeout,
        clearTimer: clearTimeout,
        openDirect,
        networkType: async () => 'WIFI',
        networkIdentity: async () => identity
      },
      {
        hysteresis,
        host: () => host,
        canSchedule: () => true,
        canAttempt: () => true,
        beginOperation: () => {},
        migrate: async () => {},
        onDirectMigrated: async () => {},
        onDirectUnreachable: () => {},
        afterProbe: () => {}
      }
    )
    return { probe, openDirect }
  }

  it('is not dialled again while the network is the one it died on', async () => {
    const { probe, openDirect } = probeOn('WIFI|192.168.1.143', deadHere)
    probe.schedule(0)
    await vi.advanceTimersByTimeAsync(1)

    expect(openDirect).not.toHaveBeenCalled()
    probe.clear()
  })

  it('is dialled again once the verdict is ten minutes old on the same network', async () => {
    // Why: reviewed 2026-09-11 — a desktop that restarted Orca on the home
    // Wi-Fi left the phone on the billed relay for the rest of the process.
    const { probe, openDirect } = probeOn('WIFI|192.168.1.143', deadHere)
    probe.schedule(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(openDirect).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(10 * 60_000 + 61_000)

    expect(openDirect).toHaveBeenCalled()
    probe.abort()
    probe.clear()
  })

  it('is dialled again the moment the phone is on a different network', async () => {
    const { probe, openDirect } = probeOn('CELLULAR|10.20.30.40', deadHere)
    probe.schedule(0)
    await vi.advanceTimersByTimeAsync(1)

    expect(openDirect).toHaveBeenCalled()
    probe.abort()
    probe.clear()
  })
})
