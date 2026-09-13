import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => new Map<string, string>())
const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn()
}))
const platform = vi.hoisted(() => ({ OS: 'android' }))

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  ...secureStore
}))
vi.mock('react-native', () => ({ Platform: platform }))

import {
  clearMacUnlockPassword,
  macUnlockPasswordKey,
  readMacUnlockPassword,
  writeMacUnlockPassword
} from './mac-unlock-password-store'

beforeEach(() => {
  store.clear()
  vi.clearAllMocks()
  platform.OS = 'android'
  secureStore.getItemAsync.mockImplementation(async (key: string) => store.get(key) ?? null)
  secureStore.setItemAsync.mockImplementation(async (key: string, value: string) => {
    store.set(key, value)
  })
  secureStore.deleteItemAsync.mockImplementation(async (key: string) => {
    store.delete(key)
  })
})

describe('mac unlock password store', () => {
  it('gives the phone back the password it saved for that host', async () => {
    await writeMacUnlockPassword('host-1', 'hunter2')
    expect(await readMacUnlockPassword('host-1')).toBe('hunter2')
    expect(await readMacUnlockPassword('host-2')).toBeNull()
  })

  it('forgets the password when the user clears it', async () => {
    await writeMacUnlockPassword('host-1', 'hunter2')
    await clearMacUnlockPassword('host-1')
    expect(await readMacUnlockPassword('host-1')).toBeNull()
  })

  it('keeps every key inside the [A-Za-z0-9._-] SecureStore alphabet', () => {
    expect(macUnlockPasswordKey('a b/c:d')).toMatch(/^[A-Za-z0-9._-]+$/)
    expect(macUnlockPasswordKey('host-1')).toMatch(/^[A-Za-z0-9._-]+$/)
  })

  it('keeps two hosts apart even after their ids are sanitised', () => {
    expect(macUnlockPasswordKey('a b')).not.toBe(macUnlockPasswordKey('a/b'))
  })

  it('never lands in the keychain on web, where SecureStore has no backend', async () => {
    platform.OS = 'web'
    await writeMacUnlockPassword('host-1', 'hunter2')
    expect(secureStore.setItemAsync).not.toHaveBeenCalled()
    expect(await readMacUnlockPassword('host-1')).toBe('hunter2')
  })

  it('stores the secret off iCloud backups', async () => {
    await writeMacUnlockPassword('host-1', 'hunter2')
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      macUnlockPasswordKey('host-1'),
      'hunter2',
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' }
    )
  })
})
