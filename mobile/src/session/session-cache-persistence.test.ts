import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPersistedMap } from './session-cache-persistence'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn() }
}))

describe('createPersistedMap', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(AsyncStorage.getItem).mockReset()
    vi.mocked(AsyncStorage.setItem).mockReset()
    vi.mocked(AsyncStorage.setItem).mockResolvedValue(undefined)
  })

  it('writes a trimmed, bounded snapshot after a debounce', async () => {
    const map = createPersistedMap<number[]>({
      storageKey: 'k',
      maxEntries: 2,
      trim: (value) => value.slice(-1)
    })
    map.set('a', [1, 2])
    map.set('b', [3])
    map.set('c', [4, 5, 6])
    expect(map.get('a')).toBeUndefined()
    expect(AsyncStorage.setItem).not.toHaveBeenCalled()
    vi.advanceTimersByTime(700)
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1)
    expect(JSON.parse(vi.mocked(AsyncStorage.setItem).mock.calls[0]![1])).toEqual([
      ['b', [3]],
      ['c', [6]]
    ])
    vi.useRealTimers()
  })

  it('hydrates once and never overwrites an entry written meanwhile', async () => {
    vi.useRealTimers()
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(
      JSON.stringify([
        ['a', 1],
        ['b', 2]
      ])
    )
    const map = createPersistedMap<number>({ storageKey: 'k', maxEntries: 5 })
    map.set('a', 9)
    await map.hydrate()
    expect(map.get('a')).toBe(9)
    expect(map.get('b')).toBe(2)
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify([['c', 3]]))
    await map.hydrate()
    expect(map.get('c')).toBeUndefined()
  })

  it('survives corrupt storage', async () => {
    vi.useRealTimers()
    vi.mocked(AsyncStorage.getItem).mockResolvedValue('{not json')
    const map = createPersistedMap<number>({ storageKey: 'k', maxEntries: 5 })
    await map.hydrate()
    expect(map.get('a')).toBeUndefined()
  })
})

// A read that fails at app start (storage still waking, disk full) used to
// mark the store hydrated anyway: it was never read again, and the next visit's
// write replaced the whole stored blob with the one entry in memory. The
// kept-session store is one of these, and its entries say which nested agent
// status is the tab's own.
describe('a persisted cache whose stored copy could not be read', () => {
  const UNREADABLE = new Error('Database or disk is full (code 13 SQLITE_FULL)')
  let stored: string | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    stored = JSON.stringify([
      ['old-a', 1],
      ['old-b', 2]
    ])
    vi.mocked(AsyncStorage.getItem).mockReset()
    vi.mocked(AsyncStorage.setItem).mockReset()
    vi.mocked(AsyncStorage.getItem).mockImplementation(async () => stored)
    vi.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      stored = value
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.mocked(console.warn).mockRestore()
    vi.useRealTimers()
  })

  const storedKeys = () => (JSON.parse(stored ?? '[]') as [string, number][]).map(([key]) => key)

  it('keeps every stored entry when a visit is written after the failed read', async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(UNREADABLE)
    const map = createPersistedMap<number>({ storageKey: 'k', maxEntries: 5 })
    await map.hydrate()
    map.set('new', 3)
    await vi.advanceTimersByTimeAsync(700)
    expect(storedKeys()).toEqual(['old-a', 'old-b', 'new'])
    expect(map.get('old-a')).toBe(1)
  })

  it('reads storage again on the next hydrate', async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(UNREADABLE)
    const map = createPersistedMap<number>({ storageKey: 'k', maxEntries: 5 })
    await map.hydrate()
    expect(map.get('old-a')).toBeUndefined()
    await map.hydrate()
    expect(map.get('old-a')).toBe(1)
  })

  it('writes nothing while storage still cannot be read', async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValue(UNREADABLE)
    const map = createPersistedMap<number>({ storageKey: 'k', maxEntries: 5 })
    await map.hydrate()
    map.set('new', 3)
    await vi.advanceTimersByTimeAsync(700)
    expect(AsyncStorage.setItem).not.toHaveBeenCalled()
    expect(storedKeys()).toEqual(['old-a', 'old-b'])
    // Still answered from memory for this run.
    expect(map.get('new')).toBe(3)
  })

  it('says which store could not be read, and why, once per failed read', async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(UNREADABLE)
    const map = createPersistedMap<number>({ storageKey: 'codeui:chat-kept-session', maxEntries: 5 })
    await map.hydrate()
    expect(console.warn).toHaveBeenCalledTimes(1)
    const line = String(vi.mocked(console.warn).mock.calls[0]?.[0])
    expect(line).toContain('codeui:chat-kept-session')
    expect(line).toContain('SQLITE_FULL')
  })

  it('does not write over the blob while the first read is still in flight', async () => {
    let answer: (raw: string | null) => void = () => undefined
    vi.mocked(AsyncStorage.getItem).mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          answer = resolve
        })
    )
    const map = createPersistedMap<number>({ storageKey: 'k', maxEntries: 5 })
    const hydrating = map.hydrate()
    map.set('new', 3)
    await vi.advanceTimersByTimeAsync(700)
    expect(AsyncStorage.setItem).not.toHaveBeenCalled()
    answer(stored)
    await hydrating
    await vi.advanceTimersByTimeAsync(700)
    expect(storedKeys()).toEqual(['old-a', 'old-b', 'new'])
    // The write that waited and the hydrate that waited carry one change.
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1)
  })

  it('shares one read between two hydrate calls, and answers neither before it lands', async () => {
    let answer: (raw: string | null) => void = () => undefined
    vi.mocked(AsyncStorage.getItem).mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          answer = resolve
        })
    )
    const map = createPersistedMap<number>({ storageKey: 'k', maxEntries: 5 })
    const first = map.hydrate()
    let secondDone = false
    const second = map.hydrate().then(() => {
      secondDone = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(secondDone).toBe(false)
    answer(stored)
    await Promise.all([first, second])
    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1)
    expect(map.get('old-a')).toBe(1)
  })

  it('keeps the newest visit, not a stored entry, when the merged cache is over its cap', async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(UNREADABLE)
    const map = createPersistedMap<number>({ storageKey: 'k', maxEntries: 2 })
    await map.hydrate()
    map.set('new', 3)
    await vi.advanceTimersByTimeAsync(700)
    expect(storedKeys()).toEqual(['old-b', 'new'])
    expect(map.get('old-a')).toBeUndefined()
  })

  it('writes the one visit when storage held nothing', async () => {
    stored = null
    const map = createPersistedMap<number>({ storageKey: 'k', maxEntries: 5 })
    await map.hydrate()
    map.set('new', 3)
    await vi.advanceTimersByTimeAsync(700)
    expect(storedKeys()).toEqual(['new'])
  })
})
