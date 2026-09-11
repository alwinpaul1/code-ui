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
  loadTerminalEngine,
  parseTerminalEngine,
  saveTerminalEngine
} from './terminal-engine-preference'

beforeEach(() => {
  asyncStorage.store.clear()
  asyncStorage.getItem.mockClear()
})

describe('which engine draws the terminal', () => {
  it('ships ghostty by default', async () => {
    expect(await loadTerminalEngine()).toBe('ghostty')
  })

  it('keeps the WebView choice across launches when the user opts back into it', async () => {
    await saveTerminalEngine('webview')

    expect(await loadTerminalEngine()).toBe('webview')
  })

  it('falls back to ghostty on an unknown or corrupt value', () => {
    expect(parseTerminalEngine('xterm')).toBe('ghostty')
    expect(parseTerminalEngine('')).toBe('ghostty')
    expect(parseTerminalEngine(null)).toBe('ghostty')
  })

  it('still opens a terminal when storage itself is unreadable', async () => {
    asyncStorage.getItem.mockRejectedValueOnce(new Error('storage unavailable'))

    expect(await loadTerminalEngine()).toBe('ghostty')
  })
})
