import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  peekChatExpandTools,
  resetSessionViewPreferenceMemoryForTests
} from '../storage/session-view-preferences'
import {
  useMobileChatExpandTools,
  useMobileChatExpandToolsPreference,
  type MobileChatExpandToolsPreference
} from './use-mobile-chat-expand-tools'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), getAllKeys: vi.fn(), multiGet: vi.fn() }
}))

let live: boolean | null = null
let pref: MobileChatExpandToolsPreference | null = null

function Reader() {
  live = useMobileChatExpandTools()
  return null
}

function Switcher() {
  pref = useMobileChatExpandToolsPreference()
  return null
}

describe('the Expand tool calls hooks', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    vi.mocked(AsyncStorage.getItem).mockReset()
    vi.mocked(AsyncStorage.setItem).mockReset()
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(null)
    vi.mocked(AsyncStorage.setItem).mockResolvedValue(undefined)
    resetSessionViewPreferenceMemoryForTests()
    live = null
    pref = null
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function mount(element: ReturnType<typeof createElement>): Promise<void> {
    await act(async () => {
      renderer = create(element)
      await Promise.resolve()
    })
  }

  it('reads off before storage has answered, and when it has nothing', async () => {
    await mount(createElement(Reader))
    expect(live).toBe(false)
  })

  it('follows a save made elsewhere while mounted, with no remount', async () => {
    await mount(createElement('div', null, createElement(Reader), createElement(Switcher)))
    expect(live).toBe(false)
    await act(async () => {
      pref!.setExpandTools(true)
      await Promise.resolve()
    })
    expect(live).toBe(true)
    expect(vi.mocked(AsyncStorage.setItem)).toHaveBeenCalledWith('orca:chatExpandTools', 'on')
  })

  it('goes back to what storage holds when the write is refused', async () => {
    await mount(createElement(Switcher))
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'))
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(null)
    await act(async () => {
      pref!.setExpandTools(true)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(pref!.expandTools).toBe(false)
    expect(peekChatExpandTools()).toBe(false)
  })
})
