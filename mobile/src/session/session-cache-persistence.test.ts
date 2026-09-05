import AsyncStorage from '@react-native-async-storage/async-storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
