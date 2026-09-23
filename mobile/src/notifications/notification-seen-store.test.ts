import { beforeEach, describe, expect, it, vi } from 'vitest'
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
