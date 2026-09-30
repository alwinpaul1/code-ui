import { createElement, useRef, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The host screen's own identity under a locked Keychain. loadHosts() drops a host whose credential
 * read throws, so the host screen, the most-seen place in the app, took the whole view for "Host
 * not found" over a desktop the home screen still listed (sweep, 2026-09-30). The real host store
 * runs; AsyncStorage and the Keychain under it are doubles, and the Keychain rejects as a locked
 * one does.
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
    setItem: async (key: string, raw: string) => {
      if (key === 'orca:hosts') {
        storage.hosts = raw
      }
    },
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
vi.mock('../transport/host-credential-cleanup', () => ({
  cancelPendingHostCredentialCleanup: async () => undefined,
  recordHostCredentialCleanupIntent: async () => undefined,
  scheduleHostCredentialCleanup: async () => undefined,
  retryPendingHostCredentialCleanups: async () => undefined
}))
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('../storage/preferences', () => ({ loadPinnedIds: async () => [] }))

import { resetHostStoreForTests } from '../transport/host-store'
import { resetMobileRelayHostOverlayStoreForTests } from '../transport/mobile-relay-host-overlay-store'
import type { RpcClient } from '../transport/rpc-client'
import type { HostScreenState } from './use-host-screen-state'
import { useHostScreenIdentity } from './use-host-screen-identity'

const stored = (id: string, name: string) => ({
  id,
  name,
  endpoint: `ws://192.168.1.10:676${id.slice(-1)}`,
  publicKeyB64: `key-${id}`,
  lastConnected: 0
})

type Seen = { error: string; hostName: string }
let seen: Seen = { error: '', hostName: '' }
let renderer: ReactTestRenderer | null = null

/** The hook against the two pieces of screen state it owns; the rest are no-ops. */
function Probe({
  lastConnectedAt,
  client = null
}: {
  lastConnectedAt: number | null
  client?: RpcClient | null
}) {
  const [error, setError] = useState('')
  const [hostName, setHostName] = useState('')
  const clientRef = useRef<RpcClient | null>(null)
  seen = { error, hostName }
  const noop = () => {}
  const state = {
    clientRef,
    repoMetadataFetchedAtRef: { current: 0 },
    setCatalogError: noop,
    setError,
    setHostLabelById: noop,
    setHostName,
    setHostPlatform: noop,
    setLastKnownWorktrees: noop,
    setPinnedIds: noop,
    setRepoColorsByName: noop,
    setRepoHostIdByRepoId: noop,
    setRepoIconsByName: noop,
    setWorktrees: noop,
    setWorktreesLoaded: noop
  } as unknown as HostScreenState
  useHostScreenIdentity({ client, hostId: 'host-1', lastConnectedAt, state })
  return null
}

async function mount(lastConnectedAt: number | null = null): Promise<void> {
  await act(async () => {
    renderer = create(createElement(Probe, { lastConnectedAt }))
  })
}

async function connectedAt(lastConnectedAt: number): Promise<void> {
  await act(async () => {
    renderer?.update(createElement(Probe, { lastConnectedAt }))
  })
}

beforeEach(() => {
  resetHostStoreForTests()
  resetMobileRelayHostOverlayStoreForTests()
  storage.hosts = JSON.stringify([stored('host-1', 'Studio Mac'), stored('host-2', 'Laptop')])
  storage.hostsRead = null
  storage.locked = new Set()
  storage.tokens = new Map([
    ['host-1', 'token-1'],
    ['host-2', 'token-2']
  ])
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.restoreAllMocks()
})

describe('the host screen when its desktop cannot be read', () => {
  it('does not call a Keychain-locked desktop not found', async () => {
    storage.locked.add('host-1')
    await mount()

    expect(seen.error).toBe(
      "This paired desktop can't be read right now. Reopen this screen in a moment."
    )
  })

  it('says a desktop with no credential needs pairing again', async () => {
    storage.tokens.delete('host-1')
    await mount()

    expect(seen.error).toBe(
      'This paired desktop needs to be paired again. Scan its code from the home screen.'
    )
  })

  it('says removed only when the host list no longer has the desktop, one host or none', async () => {
    storage.hosts = JSON.stringify([stored('host-2', 'Laptop')])
    await mount()
    expect(seen.error).toBe('This desktop was removed from this phone.')
    act(() => renderer?.unmount())

    storage.hosts = JSON.stringify([])
    await mount()
    expect(seen.error).toBe('This desktop was removed from this phone.')
  })

  it('says the desktops could not be read, instead of leaving the read unhandled, when it fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    storage.hostsRead = new Error('database disk image is malformed')
    await mount()

    expect(seen.error).toBe("Couldn't read your paired desktops. Reopen this screen in a moment.")
    expect(warn).toHaveBeenCalled()
  })

  it('names a readable desktop in a one-host list and raises no error', async () => {
    storage.hosts = JSON.stringify([stored('host-1', 'Studio Mac')])
    await mount()

    expect(seen).toEqual({ error: '', hostName: 'Studio Mac' })
  })

  it('stops saying the desktop cannot be read once it connects', async () => {
    storage.locked.add('host-1')
    await mount(null)
    expect(seen.error).toMatch(/can't be read right now/)

    // The Keychain unlocks and the client opener, retrying, reads the credential and connects.
    storage.locked.clear()
    await connectedAt(1_000)

    expect(seen).toEqual({ error: '', hostName: 'Studio Mac' })
  })

  it('does not take the screen from a desktop whose client is open when a later read fails', async () => {
    // The opener read this desktop to open its client; a host list that will not read now is a
    // storage hiccup, and the screen over a working connection stays the screen.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    storage.hostsRead = new Error('database disk image is malformed')
    await act(async () => {
      renderer = create(createElement(Probe, { lastConnectedAt: 1_000, client: {} as RpcClient }))
    })

    expect(seen.error).toBe('')
    expect(warn).toHaveBeenCalled()
  })

  it('lets go of the screen once the desktop connects, even when the next read fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    storage.locked.add('host-1')
    await mount(null)
    expect(seen.error).toMatch(/can't be read right now/)

    // The opener read it and connected; the screen's own re-read then hits a storage failure.
    storage.hostsRead = new Error('database disk image is malformed')
    await act(async () => {
      renderer?.update(createElement(Probe, { lastConnectedAt: 1_000, client: {} as RpcClient }))
    })

    expect(seen.error).toBe('')
    expect(warn).toHaveBeenCalled()
  })

  it('reads a desktop that stays unreadable once per new connection, not once per render', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    storage.hostsRead = new Error('database disk image is malformed')
    await mount(null)
    await connectedAt(1_000)
    await connectedAt(1_000)

    expect(seen.error).toMatch(/Couldn't read your paired desktops/)
    // One read when the screen opened and one for the new connection.
    expect(warn).toHaveBeenCalledTimes(2)
  })
})
