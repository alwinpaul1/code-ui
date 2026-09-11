import { beforeEach, describe, expect, it, vi } from 'vitest'

const asyncStorage = vi.hoisted(() => {
  const store = new Map<string, string>()
  return {
    store,
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key)
    })
  }
})
vi.mock('@react-native-async-storage/async-storage', () => ({ default: asyncStorage }))

import {
  forgetHeldFloor,
  heldFloorsToRelease,
  readHeldFloors,
  rememberHeldFloor
} from './mobile-held-floor-store'

beforeEach(() => {
  asyncStorage.store.clear()
  asyncStorage.getItem.mockClear()
})

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
    asyncStorage.store.set('mobile.terminal.held-floors.v1', '{not json')

    expect(await readHeldFloors()).toEqual([])
  })

  it('opens the session normally when storage itself is unreadable', async () => {
    asyncStorage.getItem.mockRejectedValueOnce(new Error('storage unavailable'))

    expect(await readHeldFloors()).toEqual([])
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
