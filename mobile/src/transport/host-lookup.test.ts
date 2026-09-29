import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What a screen opened for one desktop may say about it. loadHosts() drops a host whose Keychain
 * read throws, so Edit said "This host was removed from this phone." and Accounts and the host
 * screen "Host not found" over a desktop the home screen still listed (review, 2026-09-30).
 */

const storage = vi.hoisted(() => ({
  hosts: null as string | null,
  hostsRead: null as Error | null,
  locked: new Set<string>(),
  tokens: new Map<string, string>()
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => {
      if (key === 'orca:hosts') {
        if (storage.hostsRead) {
          throw storage.hostsRead
        }
        return storage.hosts
      }
      return null
    },
    setItem: async () => undefined,
    removeItem: async () => undefined
  }
}))
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: async (key: string) => {
    const hostId = [...storage.locked, ...storage.tokens.keys()].find((id) => key.endsWith(id))
    if (hostId && storage.locked.has(hostId)) {
      throw new Error('keychain locked')
    }
    return hostId ? (storage.tokens.get(hostId) ?? null) : null
  },
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined
}))
vi.mock('./host-credential-cleanup', () => ({
  cancelPendingHostCredentialCleanup: async () => undefined,
  recordHostCredentialCleanupIntent: async () => undefined,
  scheduleHostCredentialCleanup: async () => undefined,
  retryPendingHostCredentialCleanups: async () => undefined
}))
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))

import {
  describeHostLookup,
  HOST_LOOKUP_FAILED_COPY,
  HOST_MISSING_COPY,
  HOST_NOT_LISTED_COPY,
  HOST_UNAVAILABLE_COPY,
  lookUpPairedHost
} from './host-lookup'
import { loadHosts, resetHostStoreForTests } from './host-store'
import { resetMobileRelayHostOverlayStoreForTests } from './mobile-relay-host-overlay-store'
import { EMPTY_HOSTS_FAILED_COPY } from './use-loaded-hosts'
import type { HostCatalogEntry, HostProfile } from './types'

const profile = (id: string, name = id): HostProfile => ({
  id,
  name,
  endpoint: `ws://192.168.1.10:676${id.slice(-1)}`,
  deviceToken: `token-${id}`,
  publicKeyB64: `key-${id}`,
  lastConnected: 0
})
const ready = (id: string, name?: string): HostCatalogEntry => {
  const { deviceToken: _token, ...rest } = profile(id, name)
  return { ...rest, credentialStatus: 'ready', profile: profile(id, name) }
}
const locked = (id: string, name?: string): HostCatalogEntry => ({
  ...ready(id, name),
  credentialStatus: 'temporarily-unavailable',
  profile: null
})
const noCredential = (id: string, name?: string): HostCatalogEntry => ({
  ...ready(id, name),
  credentialStatus: 'missing',
  profile: null
})

describe('what a screen may say about the desktop it was opened for', () => {
  it('hands back the profile of a listed desktop whose credential reads', () => {
    expect(describeHostLookup([ready('a'), ready('b', 'Desk')], 'b')).toEqual({
      kind: 'ready',
      host: profile('b', 'Desk')
    })
  })

  it('does not call a desktop the Keychain cannot read right now removed', () => {
    const lookup = describeHostLookup([ready('a'), locked('b', 'Desk')], 'b')
    expect(lookup).toEqual({ kind: 'unavailable', name: 'Desk', message: HOST_UNAVAILABLE_COPY })
    expect(HOST_UNAVAILABLE_COPY).toMatch(
      /can't be read right now\. Reopen this screen in a moment/
    )
    expect(HOST_UNAVAILABLE_COPY).not.toMatch(/removed|not found|unlock/i)
  })

  it('says a desktop with no credential needs pairing again, not that it cannot be read', () => {
    const lookup = describeHostLookup([noCredential('b', 'Desk')], 'b')
    expect(lookup).toEqual({ kind: 'missing', name: 'Desk', message: HOST_MISSING_COPY })
    expect(HOST_MISSING_COPY).toMatch(/paired again/)
    expect(HOST_MISSING_COPY).not.toMatch(/removed|can't be read/)
  })

  it('says removed only when the catalog does not list the desktop, in an empty catalog too', () => {
    expect(describeHostLookup([ready('a')], 'b')).toEqual({
      kind: 'not-listed',
      message: HOST_NOT_LISTED_COPY
    })
    expect(describeHostLookup([], 'b')).toEqual({
      kind: 'not-listed',
      message: HOST_NOT_LISTED_COPY
    })
  })

  it('finds the one desktop of a one-desktop catalog in each state', () => {
    expect(describeHostLookup([ready('a')], 'a').kind).toBe('ready')
    expect(describeHostLookup([locked('a')], 'a').kind).toBe('unavailable')
    expect(describeHostLookup([noCredential('a')], 'a').kind).toBe('missing')
  })

  it('words a failed read the way the host lists do', () => {
    expect(HOST_LOOKUP_FAILED_COPY).toBe(EMPTY_HOSTS_FAILED_COPY)
  })
})

describe('looking a desktop up through the real host store', () => {
  beforeEach(() => {
    resetHostStoreForTests()
    resetMobileRelayHostOverlayStoreForTests()
    storage.hosts = JSON.stringify(
      [profile('host-1', 'Studio Mac'), profile('host-2', 'Laptop')].map(
        ({ deviceToken: _token, ...rest }) => rest
      )
    )
    storage.hostsRead = null
    storage.locked = new Set()
    storage.tokens = new Map([
      ['host-1', 'token-1'],
      ['host-2', 'token-2']
    ])
  })

  it('still finds a desktop that loadHosts() drops under a locked Keychain', async () => {
    storage.locked.add('host-1')

    expect((await loadHosts()).find((host) => host.id === 'host-1')).toBeUndefined()
    expect(await lookUpPairedHost('host-1')).toEqual({
      kind: 'unavailable',
      name: 'Studio Mac',
      message: HOST_UNAVAILABLE_COPY
    })
  })

  it('reads a desktop whose credential is there', async () => {
    const lookup = await lookUpPairedHost('host-2')
    expect(lookup.kind === 'ready' && lookup.host.deviceToken).toBe('token-2')
  })

  it('resolves, logged, instead of rejecting when the host list cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    storage.hostsRead = new Error('database disk image is malformed')

    expect(await lookUpPairedHost('host-1')).toEqual({
      kind: 'failed',
      message: HOST_LOOKUP_FAILED_COPY
    })
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[hosts]'),
      expect.objectContaining({ message: 'database disk image is malformed' })
    )
    warn.mockRestore()
  })
})
