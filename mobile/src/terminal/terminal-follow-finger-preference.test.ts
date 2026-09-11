import { beforeEach, describe, expect, it, vi } from 'vitest'

const asyncStorage = vi.hoisted(() => {
  const store = new Map<string, string>()
  return {
    store,
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    })
  }
})
vi.mock('@react-native-async-storage/async-storage', () => ({ default: asyncStorage }))

import {
  loadTerminalFollowFinger,
  parseTerminalFollowFinger,
  saveTerminalFollowFinger
} from './terminal-follow-finger-preference'

beforeEach(() => {
  asyncStorage.store.clear()
  asyncStorage.getItem.mockClear()
})

describe('moving the grid under the finger on agent tabs', () => {
  it('is off for a fresh install: the grid shows only what the host painted', async () => {
    expect(await loadTerminalFollowFinger()).toBe(false)
  })

  it('stays on across launches once the user opts in', async () => {
    await saveTerminalFollowFinger(true)

    expect(await loadTerminalFollowFinger()).toBe(true)
  })

  it('treats a corrupt value as off', () => {
    expect(parseTerminalFollowFinger('maybe')).toBe(false)
    expect(parseTerminalFollowFinger(null)).toBe(false)
  })

  it('still opens a terminal when storage itself is unreadable', async () => {
    asyncStorage.getItem.mockRejectedValueOnce(new Error('storage unavailable'))

    expect(await loadTerminalFollowFinger()).toBe(false)
  })
})
