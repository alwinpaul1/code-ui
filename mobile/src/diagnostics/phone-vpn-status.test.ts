import { afterEach, describe, expect, it, vi } from 'vitest'

// Why: `expo` has no Node entry. The screen reads the real native module through it; these tests
// hand `readPhoneVpnStatus` a double instead, so the import only has to resolve.
vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }))
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))

import {
  describePhoneVpn,
  phoneVpnUnreachableContext,
  readPhoneVpnStatus,
  type PhoneVpnStatus
} from './phone-vpn-status'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readPhoneVpnStatus', () => {
  it('reads an active VPN that carries the app and covers the endpoint', async () => {
    const phoneVpnStatus = vi.fn(async () => ({
      active: true,
      carriesAppTraffic: true,
      routesEndpoint: true
    }))

    await expect(
      readPhoneVpnStatus('ws://192.168.137.1:6768', { phoneVpnStatus })
    ).resolves.toEqual({
      kind: 'known',
      active: true,
      carriesAppTraffic: true,
      routesEndpoint: true
    })
    expect(phoneVpnStatus).toHaveBeenCalledWith('192.168.137.1')
  })

  it('reads no VPN', async () => {
    const phoneVpnStatus = async () => ({
      active: false,
      carriesAppTraffic: false,
      routesEndpoint: null
    })

    await expect(readPhoneVpnStatus('ws://192.168.1.20:6768', { phoneVpnStatus })).resolves.toEqual(
      {
        kind: 'known',
        active: false,
        carriesAppTraffic: false,
        routesEndpoint: null
      }
    )
  })

  it('asks about routes only for an IPv4 literal, never a name the native side would have to resolve', async () => {
    const phoneVpnStatus = vi.fn(async () => ({
      active: true,
      carriesAppTraffic: true,
      routesEndpoint: null
    }))

    await readPhoneVpnStatus('ws://studio.local:6768', { phoneVpnStatus })
    await readPhoneVpnStatus('not a url', { phoneVpnStatus })

    expect(phoneVpnStatus.mock.calls).toEqual([[null], [null]])
  })

  it('is unknown, not "no VPN", when this build has no native check', async () => {
    await expect(readPhoneVpnStatus('ws://192.168.1.20:6768', null)).resolves.toEqual({
      kind: 'unknown',
      reason: 'check unavailable on this build'
    })
    await expect(readPhoneVpnStatus('ws://192.168.1.20:6768', {})).resolves.toEqual({
      kind: 'unknown',
      reason: 'check unavailable on this build'
    })
  })

  it('is unknown, and says why, when the native check throws or rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const rejects = async () => {
      throw new Error('SecurityException: ACCESS_NETWORK_STATE')
    }
    const throwsSynchronously = () => {
      throw new Error('ReactContextLost')
    }

    await expect(
      readPhoneVpnStatus('ws://192.168.1.20:6768', { phoneVpnStatus: rejects })
    ).resolves.toEqual({
      kind: 'unknown',
      reason: 'check failed: SecurityException: ACCESS_NETWORK_STATE'
    })
    await expect(
      readPhoneVpnStatus('ws://192.168.1.20:6768', { phoneVpnStatus: throwsSynchronously })
    ).resolves.toEqual({ kind: 'unknown', reason: 'check failed: ReactContextLost' })
    // The line logcat keeps names the check, so a silent fallback to the old copy is traceable.
    expect(warn).toHaveBeenCalledWith(
      '[diagnostics] phone VPN check failed',
      'SecurityException: ACCESS_NETWORK_STATE'
    )
  })

  // Review, 2026-09-27: Troubleshooting awaits this beside the LAN probe, so a native call that
  // never settles held the whole host row with it.
  it('gives up after 2 s and says so, leaving no timer behind', async () => {
    vi.useFakeTimers()
    try {
      const pending = readPhoneVpnStatus('ws://192.168.1.20:6768', {
        phoneVpnStatus: () => new Promise(() => undefined)
      })
      await vi.advanceTimersByTimeAsync(2000)

      await expect(pending).resolves.toEqual({
        kind: 'unknown',
        reason: 'check timed out after 2 s'
      })
      expect(vi.getTimerCount()).toBe(0)

      await readPhoneVpnStatus('ws://192.168.1.20:6768', {
        phoneVpnStatus: async () => ({
          active: false,
          carriesAppTraffic: false,
          routesEndpoint: null
        })
      })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('is unknown when the native answer is not the shape it promised', async () => {
    for (const answer of [null, 'yes', { active: 'true' }, { carriesAppTraffic: true }]) {
      await expect(
        readPhoneVpnStatus('ws://192.168.1.20:6768', { phoneVpnStatus: async () => answer })
      ).resolves.toEqual({ kind: 'unknown', reason: 'check returned an unexpected answer' })
    }
  })
})

describe('phoneVpnUnreachableContext', () => {
  it('passes a known answer through and leaves an unknown one unknown', () => {
    expect(
      phoneVpnUnreachableContext({
        kind: 'known',
        active: true,
        carriesAppTraffic: true,
        routesEndpoint: false
      })
    ).toEqual({ phoneVpnActive: true, phoneVpnRoutesEndpoint: false })
    expect(
      phoneVpnUnreachableContext({ kind: 'unknown', reason: 'check unavailable on this build' })
    ).toEqual({
      phoneVpnActive: null,
      phoneVpnRoutesEndpoint: null
    })
  })
})

describe('describePhoneVpn', () => {
  const cases: [PhoneVpnStatus, string][] = [
    [
      { kind: 'known', active: true, carriesAppTraffic: true, routesEndpoint: true },
      'active · carries this app · routes 192.168.137.1'
    ],
    [
      { kind: 'known', active: true, carriesAppTraffic: false, routesEndpoint: false },
      'active · this app bypasses it · leaves 192.168.137.1 alone'
    ],
    [
      { kind: 'known', active: true, carriesAppTraffic: true, routesEndpoint: null },
      'active · carries this app'
    ],
    [{ kind: 'known', active: false, carriesAppTraffic: false, routesEndpoint: null }, 'none'],
    [{ kind: 'unknown', reason: 'check failed: boom' }, 'unknown (check failed: boom)']
  ]

  it.each(cases)('reads %j as a report line', (status, line) => {
    expect(describePhoneVpn(status, 'ws://192.168.137.1:6768')).toBe(line)
  })
})
