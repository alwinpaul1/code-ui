import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Home decides "no desktops" / "these desktops" from a read it made earlier. Pairing the first
 * desktop or removing the last happens on other screens, so home compares this counter on return.
 * It must move only when the SET of host ids changes (an add, a collapsed duplicate, a row
 * actually removed), and NOT for any rewrite of an existing host's row: the last-connected stamp,
 * the direct-route memory on each network change, a relay upgrade, a same-id re-pair. Those all
 * run while home sits underneath, and a move blanks and remounts its list.
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
import {
  removeHost,
  resetHostStoreForTests,
  saveExistingHostRelayUpgrade,
  saveHost,
  updateLastConnected
} from './host-store'
import { DirectVerdictMemory } from './mobile-direct-verdict-memory'

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

  it('stays put for the direct-route memory rewriting the row on each network change', async () => {
    await saveHost(HOST)
    const before = getHostMembershipRevision()
    let current = { ...HOST } as typeof HOST & Record<string, unknown>
    const memory = new DirectVerdictMemory(
      { saveHost, now: () => 1000, networkIdentity: async () => 'wifi-a' } as never,
      () => current as never,
      (next) => {
        current = next as never
      }
    )
    memory.remember(false)
    await vi.waitFor(() => expect(current.directUnreachableSince).toBeDefined())
    await vi.waitFor(() => expect(stored).toContain('directUnreachableSince'))
    memory.forget()
    await vi.waitFor(() => expect(stored).not.toContain('directUnreachableSince'))
    expect(getHostMembershipRevision()).toBe(before)
  })

  it('stays put for a relay upgrade and for a same-id re-pair of a paired desktop', async () => {
    await saveHost(HOST)
    const before = getHostMembershipRevision()
    await saveExistingHostRelayUpgrade({ ...HOST, deviceToken: 'upgraded' })
    await saveHost({ ...HOST, name: 'Renamed', deviceToken: 'again' })
    expect(getHostMembershipRevision()).toBe(before)
  })

  it('moves when a re-pair under a new id collapses a duplicate of the same key', async () => {
    await saveHost(HOST)
    const before = getHostMembershipRevision()
    await saveHost({ ...HOST, id: 'host-2' })
    expect(getHostMembershipRevision()).toBeGreaterThan(before)
  })

  it('stays put when the row to remove is not there', async () => {
    await saveHost(HOST)
    const before = getHostMembershipRevision()
    await removeHost('never-paired')
    expect(getHostMembershipRevision()).toBe(before)
  })
})
