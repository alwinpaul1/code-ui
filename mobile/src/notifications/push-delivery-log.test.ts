import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage')

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

  /**
   * A notification id is NOT unique across desktop restarts.
   * `buildAgentNotificationId` is `agent:<worktreeId>:<paneKey>:<stateStartedAt>`,
   * so an agent still sitting in the same state re-issues the same id under the
   * new counter. Deduping on the id alone therefore drops the new push as if it
   * were the old one — and the log then reports only the DEAD epoch's entry,
   * which cannot match the desktop's live buffer, so the catch-up replays it and
   * the reader sees the banner twice. Exactly what the log exists to prevent.
   *
   * notification-reconnect-catchup.ts clears `session.seen` on every epoch change
   * for this same reason; this log needs the equivalent.
   */
  it('does not mistake a re-issued id under a new epoch for one it already showed', async () => {
    await recordDeliveredPush('host-a', {
      notificationId: 'n-7',
      notificationEpoch: 'epoch-1',
      notificationSeq: 3
    })
    await recordDeliveredPush('host-a', {
      notificationId: 'n-7',
      notificationEpoch: 'epoch-2',
      notificationSeq: 3
    })
    expect(await loadDeliveredPushes('host-a')).toContainEqual({
      notificationId: 'n-7',
      notificationEpoch: 'epoch-2',
      notificationSeq: 3
    })
  })

  // The dead counter's entries can never match the live buffer, so keeping them
  // only spends the 256 the desktop will accept.
  it('forgets the previous counter once a push arrives under a new one', async () => {
    await recordDeliveredPush('host-a', {
      notificationId: 'n-1',
      notificationEpoch: 'epoch-1',
      notificationSeq: 1
    })
    await recordDeliveredPush('host-a', {
      notificationId: 'n-2',
      notificationEpoch: 'epoch-2',
      notificationSeq: 1
    })
    expect(await loadDeliveredPushes('host-a')).toEqual([
      { notificationId: 'n-2', notificationEpoch: 'epoch-2', notificationSeq: 1 }
    ])
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

// Review of 2026-09-30: the whole list lives under one key per host, and a
// read the store refused was cached as an empty list. The next push wrote
// itself alone over the stored list, so every push recorded before it was no
// longer reported, and the next catch-up replayed each one as a second banner.
describe('a push recorded while the stored list cannot be read', () => {
  const unreadable = new Error('storage unavailable')
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    store = new Map()
    failStorage = false
    resetDeliveredPushCacheForTests()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => warn.mockRestore())

  const onDisk = () => JSON.parse(store.get('orca:deliveredPushes:host-a') ?? '[]') as unknown[]

  it('keeps every push already recorded, says why it wrote nothing, and saves it with the next push', async () => {
    await recordDeliveredPush('host-a', entry(1))
    await recordDeliveredPush('host-a', entry(2))
    // A new process: the background task that shows the next push.
    resetDeliveredPushCacheForTests()
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(unreadable).mockRejectedValueOnce(unreadable)

    await recordDeliveredPush('host-a', entry(3))

    expect(onDisk()).toEqual([entry(1), entry(2)])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]).toEqual([
      expect.stringMatching(/^\[storage\] could not save the delivered pushes: the stored ones could not be read/),
      unreadable
    ])
    expect(cachedDeliveredPushes('host-a')).toEqual([entry(3)])

    await recordDeliveredPush('host-a', entry(4))
    expect(onDisk()).toEqual([entry(1), entry(2), entry(3), entry(4)])
  })

  it('records the push at once when the store refuses one read', async () => {
    await recordDeliveredPush('host-a', entry(1))
    resetDeliveredPushCacheForTests()
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(unreadable)

    await recordDeliveredPush('host-a', entry(2))

    expect(onDisk()).toEqual([entry(1), entry(2)])
  })

  it('reads the store again after a warm-up it refused, instead of reporting nothing all run', async () => {
    await recordDeliveredPush('host-a', entry(1))
    resetDeliveredPushCacheForTests()
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(unreadable).mockRejectedValueOnce(unreadable)

    expect(await loadDeliveredPushes('host-a')).toEqual([])
    expect(warn.mock.calls).toEqual([['[storage] could not read the delivered pushes', unreadable]])
    expect(await loadDeliveredPushes('host-a')).toEqual([entry(1)])
  })

  it('does not let a slow warm-up read undo a push recorded while it was out', async () => {
    await recordDeliveredPush('host-a', entry(1))
    resetDeliveredPushCacheForTests()
    const staleRaw = store.get('orca:deliveredPushes:host-a') ?? null
    let answerWarmUp: (raw: string | null) => void = () => undefined
    vi.mocked(AsyncStorage.getItem).mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          answerWarmUp = resolve
        })
    )

    const warmUp = seedDeliveredPushes('host-a')
    await recordDeliveredPush('host-a', entry(2))
    answerWarmUp(staleRaw)
    await warmUp
    await recordDeliveredPush('host-a', entry(3))

    expect(onDisk()).toEqual([entry(1), entry(2), entry(3)])
    expect(cachedDeliveredPushes('host-a')).toEqual([entry(1), entry(2), entry(3)])
  })

  it('says in one line why a push was not saved, and saves it with the next one', async () => {
    const full = new Error('database or disk is full')
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(full)

    await recordDeliveredPush('host-a', entry(1))

    expect(warn.mock.calls).toEqual([['[storage] could not save the delivered pushes', full]])
    await recordDeliveredPush('host-a', entry(2))
    expect(onDisk()).toEqual([entry(1), entry(2)])
  })
})
