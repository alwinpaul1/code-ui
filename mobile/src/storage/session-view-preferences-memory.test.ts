import AsyncStorage from '@react-native-async-storage/async-storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  peekDefaultSessionView,
  peekSessionViewOverrides,
  readDefaultSessionViewPreference,
  readSessionViewOverridesPreference,
  hydrateSessionViewPreferences,
  resetSessionViewPreferenceMemoryForTests,
  saveDefaultSessionView,
  updateSessionViewOverride
} from './session-view-preferences'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), getAllKeys: vi.fn(), multiGet: vi.fn() }
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

  it('warms every stored scope at app start without overriding fresher memory', async () => {
    vi.mocked(AsyncStorage.getAllKeys).mockResolvedValue([
      'orca:defaultSessionView',
      'orca:nativeChatTabs:host:wt',
      'unrelated'
    ])
    vi.mocked(AsyncStorage.multiGet).mockResolvedValue([
      ['orca:defaultSessionView', 'terminal'],
      ['orca:nativeChatTabs:host:wt', JSON.stringify({ tab1: 'chat', tab2: 'bogus' })]
    ])
    void saveDefaultSessionView('chat')
    await hydrateSessionViewPreferences()
    expect(peekDefaultSessionView()).toBe('chat')
    expect(peekSessionViewOverrides('host', 'wt')?.get('tab1')).toBe('chat')
    expect(peekSessionViewOverrides('host', 'wt')?.has('tab2')).toBe(false)
    // A scope with nothing stored is known empty once everything was read.
    expect(peekSessionViewOverrides('host', 'never-seen')).toEqual(new Map())
  })
})
