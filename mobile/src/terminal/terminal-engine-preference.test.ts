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
  it('ships the WebView until ghostty has passed Stage 0', async () => {
    expect(await loadTerminalEngine()).toBe('webview')
  })

  it('keeps the ghostty choice across launches', async () => {
    await saveTerminalEngine('ghostty')

    expect(await loadTerminalEngine()).toBe('ghostty')
  })

  it('falls back to the WebView on an unknown or corrupt value', () => {
    expect(parseTerminalEngine('xterm')).toBe('webview')
    expect(parseTerminalEngine('')).toBe('webview')
    expect(parseTerminalEngine(null)).toBe('webview')
  })

  it('still opens a terminal when storage itself is unreadable', async () => {
    asyncStorage.getItem.mockRejectedValueOnce(new Error('storage unavailable'))

    expect(await loadTerminalEngine()).toBe('webview')
  })
})
