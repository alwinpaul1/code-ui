import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A store that answers each call on a later tick, the way the native module
// does, and can refuse the next reads or writes it is asked for.
const asyncStorage = vi.hoisted(() => {
  const store = new Map<string, string>()
  const refusals = { reads: 0, writes: 0 }
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
  async function read<T>(answer: () => T): Promise<T> {
    await tick()
    if (refusals.reads > 0) {
      refusals.reads -= 1
      throw new Error('storage unavailable')
    }
    return answer()
  }
  async function write(apply: () => void): Promise<void> {
    await tick()
    if (refusals.writes > 0) {
      refusals.writes -= 1
      throw new Error('database or disk is full')
    }
    apply()
  }
  return {
    store,
    refusals,
    getItem: vi.fn((key: string) => read(() => store.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) =>
      write(() => {
        store.set(key, value)
      })
    ),
    removeItem: vi.fn((key: string) =>
      write(() => {
        store.delete(key)
      })
    )
  }
})
vi.mock('@react-native-async-storage/async-storage', () => ({ default: asyncStorage }))

import {
  forgetHeldFloor,
  heldFloorsToRelease,
  readHeldFloors,
  rememberHeldFloor,
  resetHeldFloorStoreForTests
} from './mobile-held-floor-store'

const KEY = 'mobile.terminal.held-floors.v1'
const unreadable = new Error('storage unavailable')
const full = new Error('database or disk is full')

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  resetHeldFloorStoreForTests()
  asyncStorage.store.clear()
  asyncStorage.refusals.reads = 0
  asyncStorage.refusals.writes = 0
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => warn.mockRestore())

/** What the next launch would read: storage alone, not this run's memory. */
function onDisk(): string[] {
  const raw = asyncStorage.store.get(KEY)
  return raw === undefined ? [] : (JSON.parse(raw) as string[]).sort()
}

async function remembered(): Promise<string[]> {
  return (await readHeldFloors()).sort()
}

describe('the floors this phone is holding', () => {
  it('survives the app being killed, so the next run can hand them back', async () => {
    await rememberHeldFloor('term-1')

    expect(await readHeldFloors()).toEqual(['term-1'])
  })

  it('forgets one it has already handed back', async () => {
    await rememberHeldFloor('term-1')
    await rememberHeldFloor('term-2')

    await forgetHeldFloor('term-1')

    expect(await readHeldFloors()).toEqual(['term-2'])
  })

  it('records a handle once however often the terminal is reopened', async () => {
    await rememberHeldFloor('term-1')
    await rememberHeldFloor('term-1')

    expect(await readHeldFloors()).toEqual(['term-1'])
  })

  it('reads nothing rather than throwing when the record is corrupt', async () => {
    asyncStorage.store.set(KEY, '{not json')

    expect(await readHeldFloors()).toEqual([])
  })

  it('writes over a corrupt record, since nothing in it can be handed back', async () => {
    asyncStorage.store.set(KEY, '{not json')

    await rememberHeldFloor('term-1')

    expect(onDisk()).toEqual(['term-1'])
    expect(warn).not.toHaveBeenCalled()
  })

  it('opens the session normally when storage itself is unreadable, and says why', async () => {
    await rememberHeldFloor('term-1')
    asyncStorage.refusals.reads = Number.POSITIVE_INFINITY

    expect(await readHeldFloors()).toEqual([])
    expect(warn.mock.calls).toEqual([['[storage] could not read the held terminal floors', unreadable]])

    asyncStorage.refusals.reads = 0
    expect(await readHeldFloors()).toEqual(['term-1'])
  })

  it('reads nothing from an empty store', async () => {
    expect(await readHeldFloors()).toEqual([])
  })

  it('leaves nothing stored once the last floor is handed back', async () => {
    await rememberHeldFloor('term-1')

    await forgetHeldFloor('term-1')

    expect(await readHeldFloors()).toEqual([])
    expect([...asyncStorage.store.keys()]).toEqual([])
  })

  it('keeps the floors it holds when asked to forget one it never took', async () => {
    await rememberHeldFloor('term-1')

    await forgetHeldFloor('term-unknown')

    expect(onDisk()).toEqual(['term-1'])
  })
})

// Review of 2026-09-30: each call read the whole list, changed it and wrote it
// back, and the session view fires them without waiting. Two in the same tick
// both read the old list and the later write won, so a floor the phone held
// was never recorded: after process death nothing handed it back, and the
// desk stayed at phone size with its keyboard paused.
describe('floors taken and handed back in the same tick', () => {
  it('records both of two terminals taken at once', async () => {
    await Promise.all([rememberHeldFloor('term-1'), rememberHeldFloor('term-2')])

    expect(onDisk()).toEqual(['term-1', 'term-2'])
  })

  it('keeps a terminal taken while another is handed back', async () => {
    await rememberHeldFloor('term-1')

    await Promise.all([rememberHeldFloor('term-2'), forgetHeldFloor('term-1')])

    expect(onDisk()).toEqual(['term-2'])
  })

  it('applies a take and a hand-back of one terminal in the order they were asked', async () => {
    await Promise.all([rememberHeldFloor('term-1'), forgetHeldFloor('term-1')])
    expect(onDisk()).toEqual([])

    await Promise.all([forgetHeldFloor('term-1'), rememberHeldFloor('term-1')])
    expect(onDisk()).toEqual(['term-1'])
  })
})

// The same review: a read the store refused came back as an empty list, and
// the next remember wrote its one floor over the stored ones.
describe('a floor taken or handed back while the store cannot be read', () => {
  it('keeps every floor already recorded, and records the new one once the store reads again', async () => {
    await rememberHeldFloor('term-1')
    asyncStorage.refusals.reads = Number.POSITIVE_INFINITY

    await rememberHeldFloor('term-2')

    expect(onDisk()).toEqual(['term-1'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]).toEqual([
      expect.stringMatching(/^\[storage\] could not save the held terminal floors: the stored ones could not be read/),
      unreadable
    ])

    asyncStorage.refusals.reads = 0
    await rememberHeldFloor('term-3')
    expect(onDisk()).toEqual(['term-1', 'term-2', 'term-3'])
  })

  it('records the floor at once when the store refuses one read', async () => {
    await rememberHeldFloor('term-1')
    asyncStorage.refusals.reads = 1

    await rememberHeldFloor('term-2')

    expect(onDisk()).toEqual(['term-1', 'term-2'])
    expect(warn).not.toHaveBeenCalled()
  })

  it('hands one back once the store reads again, and keeps the others', async () => {
    await rememberHeldFloor('term-1')
    await rememberHeldFloor('term-2')
    asyncStorage.refusals.reads = Number.POSITIVE_INFINITY

    await forgetHeldFloor('term-1')
    expect(onDisk()).toEqual(['term-1', 'term-2'])

    asyncStorage.refusals.reads = 0
    expect(await remembered()).toEqual(['term-2'])
    expect(onDisk()).toEqual(['term-2'])
  })

  it('says in one line why a floor it took was not recorded, and records it with the next', async () => {
    asyncStorage.refusals.writes = 1

    await rememberHeldFloor('term-1')

    expect(warn.mock.calls).toEqual([['[storage] could not save the held terminal floors', full]])
    await rememberHeldFloor('term-2')
    expect(onDisk()).toEqual(['term-1', 'term-2'])
  })

  it('says in one line why the last floor it handed back is still recorded', async () => {
    await rememberHeldFloor('term-1')
    asyncStorage.refusals.writes = 1

    await forgetHeldFloor('term-1')

    expect(warn.mock.calls).toEqual([['[storage] could not erase the held terminal floors', full]])
    expect(onDisk()).toEqual(['term-1'])
    expect(await readHeldFloors()).toEqual([])
    expect([...asyncStorage.store.keys()]).toEqual([])
  })
})

describe('deciding what to hand back on startup', () => {
  it('hands back a floor the app died holding', () => {
    expect(heldFloorsToRelease({ remembered: ['term-1'], drivingNow: [] })).toEqual(['term-1'])
  })

  it('leaves alone the terminal the phone is driving right now', () => {
    expect(
      heldFloorsToRelease({ remembered: ['term-1', 'term-2'], drivingNow: ['term-1'] })
    ).toEqual(['term-2'])
  })

  it('has nothing to hand back on a clean start', () => {
    expect(heldFloorsToRelease({ remembered: [], drivingNow: ['term-1'] })).toEqual([])
  })
})
