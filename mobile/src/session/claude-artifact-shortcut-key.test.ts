/**
 * The key only Code UI's own home-screen shortcuts carry (claude-artifact-shortcut-key.ts): made
 * once, kept in the keystore, and the only thing that lets an app-scheme link skip "Open this
 * artifact?". Every way the store can fail must make the route ask, never skip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  values: new Map<string, string>(),
  failRead: false,
  failWrite: false
}))
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => {
    if (store.failRead) {
      throw new Error('keystore locked')
    }
    return store.values.get(key) ?? null
  },
  setItemAsync: async (key: string, value: string) => {
    if (store.failWrite) {
      throw new Error('keystore full')
    }
    store.values.set(key, value)
  }
}))
let counter = 0
vi.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => (i + ++counter) % 256)
}))

import { artifactShortcutKey, isArtifactShortcutKey, resetArtifactShortcutKeyForTests } from './claude-artifact-shortcut-key'

beforeEach(() => {
  store.values.clear()
  store.failRead = false
  store.failWrite = false
  resetArtifactShortcutKeyForTests()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe("the shortcut's key", () => {
  it('is made once and every later shortcut gets the same one', async () => {
    const first = await artifactShortcutKey()
    expect(first).toMatch(/^[0-9a-f]{32}$/)
    resetArtifactShortcutKeyForTests()
    expect(await artifactShortcutKey()).toBe(first)
  })

  it('lets a link carrying it through', async () => {
    const key = (await artifactShortcutKey())!
    resetArtifactShortcutKeyForTests()
    expect(await isArtifactShortcutKey(key)).toBe(true)
  })

  it('refuses a wrong, empty or missing key', async () => {
    const key = (await artifactShortcutKey())!
    for (const wrong of [`${key}0`, key.slice(1), '', undefined, key.toUpperCase()]) {
      expect(await isArtifactShortcutKey(wrong)).toBe(false)
    }
  })

  it('refuses every key before one was ever made, and does not make one to check against', async () => {
    expect(await isArtifactShortcutKey('00000000000000000000000000000000')).toBe(false)
    expect(store.values.size).toBe(0)
  })

  it('refuses when the keystore cannot be read, and says why', async () => {
    const key = (await artifactShortcutKey())!
    resetArtifactShortcutKeyForTests()
    store.failRead = true
    expect(await isArtifactShortcutKey(key)).toBe(false)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('keystore locked'))
  })

  it('gives no key when it cannot be kept, so the shortcut asks rather than carrying one nothing can check', async () => {
    store.failWrite = true
    expect(await artifactShortcutKey()).toBeNull()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('keystore full'))
  })
})
