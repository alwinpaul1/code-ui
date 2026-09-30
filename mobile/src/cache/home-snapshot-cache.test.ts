import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Home render cache's read: a store that refused to answer is not a store with nothing in it.
 * Both used to come back null, and the Home hook then saved a snapshot of live data alone over
 * every other desktop's cached cards (review, 2026-09-30).
 */

const storage = vi.hoisted(() => ({ read: async (): Promise<string | null> => null }))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(() => storage.read()),
    setItem: vi.fn(async () => undefined)
  }
}))

async function freshCache() {
  // The cache keeps the last snapshot in memory for the process; each case starts cold.
  vi.resetModules()
  return import('./home-snapshot-cache')
}

beforeEach(() => {
  storage.read = async () => null
})

describe('reading the Home snapshot', () => {
  it('rejects when the store refuses the read, rather than answering "nothing stored"', async () => {
    storage.read = async () => {
      throw new Error('AsyncStorage is unavailable')
    }
    const cache = await freshCache()
    await expect(cache.loadHomeSnapshot()).rejects.toThrow('AsyncStorage is unavailable')
  })

  it('answers null when nothing is stored', async () => {
    const cache = await freshCache()
    await expect(cache.loadHomeSnapshot()).resolves.toBeNull()
  })

  it('answers null for a stored value it cannot read, which the next save replaces', async () => {
    storage.read = async () => '{"worktreeInfo":'
    const cache = await freshCache()
    await expect(cache.loadHomeSnapshot()).resolves.toBeNull()
  })

  it('answers the stored snapshot', async () => {
    const stored = { worktreeInfo: { mac: { hostId: 'mac' } }, accountsByHost: {}, savedAt: 1 }
    storage.read = async () => JSON.stringify(stored)
    const cache = await freshCache()
    await expect(cache.loadHomeSnapshot()).resolves.toEqual(stored)
  })
})
