import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from './rpc-client'
import type { ConnectionState } from './types'

/**
 * What the network-diagnostics log says when a desktop's client cannot be opened because its
 * credential cannot be read. The opener read loadHosts(), which drops a host whose Keychain read
 * throws, so a locked Keychain logged "Host client open failed — host-not-found; retry …" for a
 * desktop that is still paired (review, 2026-09-30). That line is the one thing left behind when
 * nobody is watching, and it sent the reader looking for a removed host. The real host store runs;
 * AsyncStorage and the Keychain under it are doubles.
 */

const storage = vi.hoisted(() => ({
  hosts: null as string | null,
  locked: new Set<string>(),
  tokens: new Map<string, string>()
}))
const openHostLogicalClientMock = vi.hoisted(() => vi.fn())

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => (key === 'orca:hosts' ? storage.hosts : null),
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
vi.mock('./host-logical-client', () => ({
  openHostLogicalClient: (...args: unknown[]) => openHostLogicalClientMock(...args)
}))
vi.mock('./connection-revival-triggers', () => ({
  subscribeConnectionRevivalTriggers: () => () => {}
}))

import { RpcClientProvider, useHostClient } from './client-context'
import { resetHostStoreForTests } from './host-store'
import { clearLiveHostClientsForTest } from './live-host-clients'
import { resetMobileRelayHostOverlayStoreForTests } from './mobile-relay-host-overlay-store'
import { connectionLogStore } from './persisted-connection-log-store'

const stored = (id: string, name: string) => ({
  id,
  name,
  endpoint: `ws://192.168.1.10:676${id.slice(-1)}`,
  publicKeyB64: `key-${id}`,
  lastConnected: 0
})

function fakeClient(): RpcClient {
  return {
    sendRequest: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    updateTerminalSubscriptionViewport: vi.fn(),
    getState: () => 'connected',
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => null,
    onStateChange: () => () => {},
    notifyForeground: vi.fn(),
    close: vi.fn()
  }
}

let observed: { client: RpcClient | null; state: ConnectionState } | null = null
let renderer: ReactTestRenderer | null = null

function Probe(): null {
  observed = useHostClient('host-1')
  return null
}

async function openHost(): Promise<void> {
  await act(async () => {
    renderer = create(createElement(RpcClientProvider, null, createElement(Probe)))
  })
}

/** The detail line of each failed open this host logged, as the diagnostics timeline draws it. */
function openFailures(): string[] {
  return connectionLogStore
    .get('host-1')
    .filter((entry) => entry.code === 'host-open-failed')
    .map((entry) => entry.detail ?? '')
}

beforeEach(() => {
  vi.useFakeTimers()
  resetHostStoreForTests()
  resetMobileRelayHostOverlayStoreForTests()
  clearLiveHostClientsForTest()
  openHostLogicalClientMock.mockReset().mockImplementation(() => fakeClient())
  storage.hosts = JSON.stringify([stored('host-1', 'Studio Mac'), stored('host-2', 'Laptop')])
  storage.locked = new Set()
  storage.tokens = new Map([
    ['host-1', 'token-1'],
    ['host-2', 'token-2']
  ])
  observed = null
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

describe('the diagnostics log when a desktop cannot be opened', () => {
  it('does not log a Keychain-locked desktop as host-not-found', async () => {
    storage.locked.add('host-1')
    await openHost()

    const failures = openFailures()
    expect(failures.at(-1)).toMatch(/^credential-unavailable; retry \d+ms \(failure 1\)$/)
    expect(failures.some((detail) => detail.includes('host-not-found'))).toBe(false)
    expect(observed).toMatchObject({ client: null, state: 'disconnected' })
  })

  it('logs a desktop with no credential as needing it, not as not found', async () => {
    storage.tokens.delete('host-1')
    await openHost()

    expect(openFailures().at(-1)).toMatch(/^credential-missing; retry/)
  })

  it('logs host-not-found only for a desktop the host list does not have, one host or none', async () => {
    storage.hosts = JSON.stringify([stored('host-2', 'Laptop')])
    await openHost()
    expect(openFailures().at(-1)).toMatch(/^host-not-found; retry/)
    act(() => renderer?.unmount())

    storage.hosts = JSON.stringify([])
    await openHost()
    expect(openFailures().at(-1)).toMatch(/^host-not-found; retry/)
  })

  it('still opens the desktop on the next retry once the Keychain unlocks', async () => {
    storage.locked.add('host-1')
    await openHost()
    expect(openHostLogicalClientMock).not.toHaveBeenCalled()

    storage.locked.clear()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(openHostLogicalClientMock).toHaveBeenCalledOnce()
    expect(observed).toMatchObject({ state: 'connected' })
  })
})
