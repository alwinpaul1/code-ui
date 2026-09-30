import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSeenKeys, loadSeenKeys, persistSeenKeys } from './notification-seen-store'

// Serial like the real store: each operation applies in submission order; a gate
// only delays when the caller hears back.
const storage = new Map<string, string>()
const gates: Array<() => void> = []
let gateWrites = false
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value)
      if (!gateWrites) {
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => gates.push(resolve))
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key)
    })
  }
}))

const KEY = 'orca:mobileNotificationsSeen:h'
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}
const keysOnDisk = () => (JSON.parse(storage.get(KEY) ?? '{"keys":null}') as { keys: string[] | null }).keys

describe('seen store writes', () => {
  beforeEach(() => {
    storage.clear()
    gates.length = 0
    gateWrites = false
  })

  it('coalesced writes always land the last state, including one queued during the final write', async () => {
    gateWrites = true
    persistSeenKeys('h', 'e', ['a'])
    persistSeenKeys('h', 'e', ['a', 'b'])
    persistSeenKeys('h', 'e', ['a', 'b', 'c'])
    expect(gates.length).toBe(1)
    gates.shift()!()
    await flush()
    expect(gates.length).toBe(1)
    persistSeenKeys('h', 'e', ['a', 'b', 'c', 'd'])
    gates.shift()!()
    await flush()
    gates.shift()?.()
    await flush()
    expect(keysOnDisk()).toEqual(['a', 'b', 'c', 'd'])
    // And a write after the drain went idle still goes out.
    gateWrites = false
    persistSeenKeys('h', 'e', ['a', 'b', 'c', 'd', 'e'])
    await flush()
    expect(keysOnDisk()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('clearSeenKeys during an in-flight write leaves nothing behind, and drops the queued one', async () => {
    gateWrites = true
    persistSeenKeys('h', 'e', ['a'])
    persistSeenKeys('h', 'e', ['a', 'b'])
    await clearSeenKeys('h')
    gates.shift()!()
    await flush()
    expect(storage.has(KEY)).toBe(false)
    expect(gates.length).toBe(0)
    expect(await loadSeenKeys('h')).toBeNull()
  })

  it('the cap keeps the newest 256 in insertion order', async () => {
    persistSeenKeys('h', 'e', Array.from({ length: 300 }, (_, i) => `k${i}`))
    await flush()
    const keys = keysOnDisk()!
    expect([keys.length, keys[0], keys[255]]).toEqual([256, 'k44', 'k299'])
  })
})

// Review of 2026-09-30: a restart whose read of the stored keys the store
// refused started from none, and the first notification it delivered wrote
// that run's keys alone over the stored ones. When that run's catch-up could
// not replay them either, the next restart re-posted popups already resolved,
// the report this store was written for (2026-09-23).
describe('seen keys written after the store refused to read them', () => {
  const unreadable = new Error('storage unavailable')
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(async () => {
    storage.clear()
    gates.length = 0
    gateWrites = false
    // A host read successfully, so no earlier case's refusal carries over.
    await loadSeenKeys('h')
    storage.set(KEY, JSON.stringify({ epoch: 'e', keys: ['k1', 'k2'] }))
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => warn.mockRestore())

  it('keeps the keys the previous run stored, under this run\'s newer ones', async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(unreadable)
    expect(await loadSeenKeys('h')).toBeNull()

    persistSeenKeys('h', 'e', ['k3'])
    await flush()

    expect(keysOnDisk()).toEqual(['k1', 'k2', 'k3'])
    expect(warn.mock.calls).toEqual([['[storage] could not read the notification seen keys', unreadable]])
  })

  // The run never had those keys in memory (its load was refused), so every
  // write it makes, not just the first, is its own keys alone unless the
  // store carries the older ones under them.
  it('keeps the keys the previous run stored through every later delivery, not just the first', async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(unreadable)
    await loadSeenKeys('h')

    persistSeenKeys('h', 'e', ['k3'])
    await flush()
    persistSeenKeys('h', 'e', ['k3', 'k4'])
    await flush()

    expect(keysOnDisk()).toEqual(['k1', 'k2', 'k3', 'k4'])
  })

  it('lets the previous run\'s keys fall out under the cap as this run\'s own fill it', async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(unreadable)
    await loadSeenKeys('h')
    persistSeenKeys('h', 'e', ['k3'])
    await flush()

    persistSeenKeys('h', 'e', Array.from({ length: 255 }, (_, i) => `n${i}`))
    await flush()
    const keys = keysOnDisk()!
    expect([keys.length, keys[0], keys[1], keys[255]]).toEqual([256, 'k2', 'n0', 'n254'])

    persistSeenKeys('h', 'e', Array.from({ length: 256 }, (_, i) => `n${i}`))
    await flush()
    expect(keysOnDisk()!.some((key) => key.startsWith('k'))).toBe(false)
  })

  it('carries none of the previous run\'s keys into the next desktop counter or past a cleared host', async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(unreadable)
    await loadSeenKeys('h')
    persistSeenKeys('h', 'e', ['k3'])
    await flush()

    persistSeenKeys('h', 'e2', ['m1'])
    await flush()
    expect(JSON.parse(storage.get(KEY)!)).toEqual({ epoch: 'e2', keys: ['m1'] })

    storage.set(KEY, JSON.stringify({ epoch: 'e', keys: ['k1', 'k2'] }))
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(unreadable)
    await loadSeenKeys('h')
    persistSeenKeys('h', 'e', ['k3'])
    await flush()
    await clearSeenKeys('h')
    persistSeenKeys('h', 'e', ['z'])
    await flush()
    expect(JSON.parse(storage.get(KEY)!)).toEqual({ epoch: 'e', keys: ['z'] })
  })

  it('carries nothing from a read that was still out when the host was cleared', async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(unreadable)
    await loadSeenKeys('h')
    let release = () => {}
    vi.mocked(AsyncStorage.getItem).mockImplementationOnce((key: string) => {
      const found = storage.get(key) ?? null
      return new Promise((resolve) => {
        release = () => resolve(found)
      })
    })
    persistSeenKeys('h', 'e', ['k3'])
    await flush()

    await clearSeenKeys('h')
    release()
    await flush()
    expect(storage.has(KEY)).toBe(false)

    persistSeenKeys('h', 'e', ['z'])
    await flush()
    expect(keysOnDisk()).toEqual(['z'])
  })

  it('writes nothing, and says why, while the store still refuses; the next delivery lands them all', async () => {
    vi.mocked(AsyncStorage.getItem)
      .mockRejectedValueOnce(unreadable)
      .mockRejectedValueOnce(unreadable)
      .mockRejectedValueOnce(unreadable)
    await loadSeenKeys('h')

    persistSeenKeys('h', 'e', ['k3'])
    await flush()

    expect(keysOnDisk()).toEqual(['k1', 'k2'])
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[1]).toEqual([
      expect.stringMatching(/^\[storage\] could not save the notification seen keys: the stored ones could not be read/),
      unreadable
    ])

    persistSeenKeys('h', 'e', ['k3', 'k4'])
    await flush()
    expect(keysOnDisk()).toEqual(['k1', 'k2', 'k3', 'k4'])
  })

  it('does not carry keys over from another counter lifetime', async () => {
    storage.set(KEY, JSON.stringify({ epoch: 'e-old', keys: ['k1', 'k2'] }))
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(unreadable)
    await loadSeenKeys('h')

    persistSeenKeys('h', 'e', ['k3'])
    await flush()

    expect(JSON.parse(storage.get(KEY)!)).toEqual({ epoch: 'e', keys: ['k3'] })
  })

  it('writes a host read successfully straight away, without reading again', async () => {
    const reads = vi.mocked(AsyncStorage.getItem).mock.calls.length

    persistSeenKeys('h', 'e', ['k3'])
    await flush()

    expect(keysOnDisk()).toEqual(['k3'])
    expect(vi.mocked(AsyncStorage.getItem).mock.calls.length).toBe(reads)
  })

  it('says in one line why the keys were not saved', async () => {
    const full = new Error('database or disk is full')
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(full)

    persistSeenKeys('h', 'e', ['k3'])
    await flush()

    expect(warn.mock.calls).toEqual([['[storage] could not save the notification seen keys', full]])
  })
})
