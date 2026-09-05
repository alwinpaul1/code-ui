import AsyncStorage from '@react-native-async-storage/async-storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  peekDefaultSessionView,
  peekSessionViewOverrides,
  readDefaultSessionViewPreference,
  readSessionViewOverridesPreference,
  resetSessionViewPreferenceMemoryForTests,
  saveDefaultSessionView,
  updateSessionViewOverride
} from './session-view-preferences'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn() }
}))

describe('session view preference memory copies', () => {
  beforeEach(() => {
    vi.mocked(AsyncStorage.getItem).mockReset()
    vi.mocked(AsyncStorage.setItem).mockReset()
    vi.mocked(AsyncStorage.setItem).mockResolvedValue(undefined)
    resetSessionViewPreferenceMemoryForTests()
  })

  it('answers null before the first read, then the loaded values synchronously', async () => {
    expect(peekDefaultSessionView()).toBeNull()
    expect(peekSessionViewOverrides('host', 'wt')).toBeNull()
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce('terminal')
    await readDefaultSessionViewPreference()
    expect(peekDefaultSessionView()).toBe('terminal')
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(JSON.stringify({ tab1: 'chat' }))
    await readSessionViewOverridesPreference('host', 'wt')
    expect(peekSessionViewOverrides('host', 'wt')?.get('tab1')).toBe('chat')
    expect(peekSessionViewOverrides('host', 'other')).toBeNull()
  })

  it('reflects writes immediately and keeps a failed read out of memory', async () => {
    void saveDefaultSessionView('chat')
    expect(peekDefaultSessionView()).toBe('chat')
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(JSON.stringify({}))
    await updateSessionViewOverride('host', 'wt', 'tab2', 'terminal')
    expect(peekSessionViewOverrides('host', 'wt')?.get('tab2')).toBe('terminal')
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage down'))
    await readSessionViewOverridesPreference('host', 'wt2')
    expect(peekSessionViewOverrides('host', 'wt2')).toBeNull()
  })
})
