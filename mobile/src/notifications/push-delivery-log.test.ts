import { beforeEach, describe, expect, it, vi } from 'vitest'

let store = new Map<string, string>()
let failStorage = false

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      if (failStorage) {
        throw new Error('storage unavailable')
      }
      return store.get(key) ?? null
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      if (failStorage) {
        throw new Error('storage unavailable')
      }
      store.set(key, value)
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key)
    })
  }
}))

const {
  recordDeliveredPush,
  seedDeliveredPushes,
  cachedDeliveredPushes,
  clearDeliveredPushes,
  resetDeliveredPushCacheForTests,
  MAX_REPORTED_DELIVERED_PUSHES
} = await import('./push-delivery-log')

/** The read a caller makes: warm the cache from storage, then read it. */
async function loadDeliveredPushes(hostId: string) {
  await seedDeliveredPushes(hostId)
  return cachedDeliveredPushes(hostId)
}

function entry(seq: number) {
  return { notificationId: `n-${seq}`, notificationEpoch: 'epoch-1', notificationSeq: seq }
}

/**
 * A push arrives while the app is DEAD. The process that shows it is gone by the
 * time the user opens the app, so the only way the next catch-up can know the
 * banner already went out is a record that outlived that process. Without it the
 * desktop replays the notification and the reader gets it twice.
 */
describe('remembering which notifications arrived by push', () => {
  beforeEach(() => {
    store = new Map()
    failStorage = false
    resetDeliveredPushCacheForTests()
  })

  it('reads back a push recorded by a process that has since exited', async () => {
    await recordDeliveredPush('host-a', entry(7))
    // The app was killed; nothing is in memory any more.
    resetDeliveredPushCacheForTests()
    expect(await loadDeliveredPushes('host-a')).toEqual([entry(7)])
  })

  it('keeps hosts apart', async () => {
    await recordDeliveredPush('host-a', entry(7))
    await recordDeliveredPush('host-b', entry(8))
    expect(await loadDeliveredPushes('host-a')).toEqual([entry(7)])
  })

  // The desktop's contract requires all three fields on every reported entry.
  // A push missing one cannot be reported, so recording it would only push a
  // reportable entry out of the bounded list.
  it.each([
    ['no epoch', { notificationId: 'n-1', notificationSeq: 1 }],
    ['no seq', { notificationId: 'n-1', notificationEpoch: 'epoch-1' }],
    ['no id', { notificationEpoch: 'epoch-1', notificationSeq: 1 }]
  ])('does not record a push with %s', async (_label, partial) => {
    await recordDeliveredPush('host-a', partial as Parameters<typeof recordDeliveredPush>[1])
    expect(await loadDeliveredPushes('host-a')).toEqual([])
  })

  it('reports each notification once even if the same push is delivered twice', async () => {
    await recordDeliveredPush('host-a', entry(7))
    await recordDeliveredPush('host-a', entry(7))
    expect(await loadDeliveredPushes('host-a')).toEqual([entry(7)])
  })

  // The desktop caps the array; going over it would fail the whole catch-up
  // request, which costs far more than forgetting the oldest push.
  it('stays within the cap the desktop accepts, dropping the oldest', async () => {
    for (let seq = 1; seq <= MAX_REPORTED_DELIVERED_PUSHES + 5; seq += 1) {
      await recordDeliveredPush('host-a', entry(seq))
    }
    const loaded = await loadDeliveredPushes('host-a')
    expect(loaded).toHaveLength(MAX_REPORTED_DELIVERED_PUSHES)
    expect(loaded[0]).toEqual(entry(6))
    expect(loaded.at(-1)).toEqual(entry(MAX_REPORTED_DELIVERED_PUSHES + 5))
  })

  // Removal is the only thing that drops these. A re-pair of the same host would
  // otherwise tell it not to send notifications it has never sent.
  it('drops everything for a host that has been removed', async () => {
    await recordDeliveredPush('host-a', entry(7))
    await recordDeliveredPush('host-b', entry(8))
    await clearDeliveredPushes('host-a')
    expect(await loadDeliveredPushes('host-a')).toEqual([])
    expect(await loadDeliveredPushes('host-b')).toEqual([entry(8)])
  })

  // Failure path: this is a best-effort optimisation over a path that already
  // works, so an unreadable store must cost a duplicate banner, never the
  // catch-up. Within the process it still reports what it saw — discarding that
  // would cause the very duplicate the log exists to prevent — and only a
  // restart, which is what the store was for, loses it.
  it('keeps reporting a push this process saw even when the store is broken', async () => {
    failStorage = true
    await expect(recordDeliveredPush('host-a', entry(7))).resolves.toBeUndefined()
    expect(await loadDeliveredPushes('host-a')).toEqual([entry(7)])
  })

  it('reports nothing after a restart if the store could not be written', async () => {
    failStorage = true
    await recordDeliveredPush('host-a', entry(7))
    failStorage = false
    resetDeliveredPushCacheForTests()
    expect(await loadDeliveredPushes('host-a')).toEqual([])
  })

  it('survives a corrupt record', async () => {
    store.set('orca:deliveredPushes:host-a', '{not json')
    expect(await loadDeliveredPushes('host-a')).toEqual([])
  })

  // Degenerate sizes.
  it('reports nothing for a host that has never had a push', async () => {
    expect(await loadDeliveredPushes('host-a')).toEqual([])
  })

  it('clearing a host that has none is not an error', async () => {
    await expect(clearDeliveredPushes('host-never')).resolves.toBeUndefined()
  })

  // The cache is what the catch-up reads, and it must not answer for a host it
  // has never read — that would report nothing while the store holds entries.
  it('reads nothing from the cache before the seed lands', () => {
    expect(cachedDeliveredPushes('host-a')).toEqual([])
  })
})
