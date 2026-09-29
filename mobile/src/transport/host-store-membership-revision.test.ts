import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Home decides "no desktops" / "these desktops" from a read it made earlier. Pairing the first
 * desktop or removing the last happens on other screens, so home compares this counter on return.
 * It must move for an add or a remove, and NOT for the last-connected stamp written on every
 * connect, or the host list would blank on each return to home.
 */
const asyncStorageMock = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn()
}))
const secureStoreMock = vi.hoisted(() => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn()
}))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: asyncStorageMock }))
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  ...secureStoreMock
}))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('./host-credential-cleanup', () => ({
  cancelPendingHostCredentialCleanup: vi.fn(async () => undefined),
  recordHostCredentialCleanupIntent: vi.fn(async () => undefined),
  scheduleHostCredentialCleanup: vi.fn(async () => undefined),
  retryPendingHostCredentialCleanups: vi.fn()
}))

import { getHostMembershipRevision } from './host-list-load-sharing'
import { removeHost, resetHostStoreForTests, saveHost, updateLastConnected } from './host-store'

const HOST = {
  id: 'host-1',
  name: 'Host 1',
  endpoint: 'ws://127.0.0.1:1',
  deviceToken: 'token',
  publicKeyB64: 'key',
  lastConnected: 0
}

describe('host membership revision', () => {
  let stored = '[]'
  beforeEach(() => {
    vi.clearAllMocks()
    resetHostStoreForTests()
    stored = '[]'
    asyncStorageMock.getItem.mockImplementation(async (key: string) =>
      key === 'orca:hosts' ? stored : null
    )
    asyncStorageMock.setItem.mockImplementation(async (key: string, raw: string) => {
      if (key === 'orca:hosts') {
        stored = raw
      }
    })
    secureStoreMock.setItemAsync.mockResolvedValue(undefined)
    secureStoreMock.deleteItemAsync.mockResolvedValue(undefined)
    secureStoreMock.getItemAsync.mockResolvedValue('token')
  })

  it('moves when a desktop is paired and when it is removed', async () => {
    const start = getHostMembershipRevision()
    await saveHost(HOST)
    const paired = getHostMembershipRevision()
    expect(paired).toBeGreaterThan(start)
    await removeHost(HOST.id)
    expect(getHostMembershipRevision()).toBeGreaterThan(paired)
  })

  it('stays put for the last-connected stamp written on each connect', async () => {
    await saveHost(HOST)
    const before = getHostMembershipRevision()
    await updateLastConnected(HOST.id)
    expect(getHostMembershipRevision()).toBe(before)
  })
})
