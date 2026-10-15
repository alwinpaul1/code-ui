import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_DOCK_HEIGHT_KEY, hydrateChatDockHeight, resetChatDockHeightForTests, useChatDock } from './use-mobile-chat-dock'

/** The composer's height a chat opens with: remembered across opens and restarts, so a session
 *  opened from a cold start holds the composer's room in its first frame (the user, 2026-10-15). */

function firstFrameHeight(keyboardUp = false): number {
  let seen: number | null = null
  function Probe() {
    const { dockHeight } = useChatDock(() => undefined, keyboardUp)
    seen ??= dockHeight
    return null
  }
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(createElement(Probe))
  })
  act(() => renderer.unmount())
  return seen!
}

describe('the composer height a chat opens with', () => {
  beforeEach(async () => {
    resetChatDockHeightForTests()
    await AsyncStorage.removeItem(CHAT_DOCK_HEIGHT_KEY)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens a session after a cold start with the composer height the last run measured', async () => {
    await AsyncStorage.setItem(CHAT_DOCK_HEIGHT_KEY, '152')
    await hydrateChatDockHeight()
    expect(firstFrameHeight()).toBe(152)
  })

  it('keeps a measured height for the next run', async () => {
    let onDockLayout!: ReturnType<typeof useChatDock>['onDockLayout']
    function Probe() {
      onDockLayout = useChatDock(() => undefined, false).onDockLayout
      return null
    }
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(createElement(Probe))
    })
    act(() => onDockLayout({ nativeEvent: { layout: { height: 140.4 } } } as never))
    act(() => renderer.unmount())
    expect(firstFrameHeight()).toBe(140)
    await vi.waitFor(async () => expect(await AsyncStorage.getItem(CHAT_DOCK_HEIGHT_KEY)).toBe('140'))
  })

  it('opens at 0 when storage cannot be read, without failing the hydrate', async () => {
    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk gone'))
    await expect(hydrateChatDockHeight()).resolves.toBeUndefined()
    expect(firstFrameHeight()).toBe(0)
  })

  it('ignores a stored height that is not a sane number', async () => {
    for (const stored of ['abc', '-20', '1e9', '']) {
      resetChatDockHeightForTests()
      await AsyncStorage.setItem(CHAT_DOCK_HEIGHT_KEY, stored)
      await hydrateChatDockHeight()
      expect({ stored, height: firstFrameHeight() }).toEqual({ stored, height: 0 })
    }
  })

  it('a hydrate landing after a measure does not overwrite the fresher measure', async () => {
    await AsyncStorage.setItem(CHAT_DOCK_HEIGHT_KEY, '90')
    let onDockLayout!: ReturnType<typeof useChatDock>['onDockLayout']
    function Probe() {
      onDockLayout = useChatDock(() => undefined, false).onDockLayout
      return null
    }
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(createElement(Probe))
    })
    act(() => onDockLayout({ nativeEvent: { layout: { height: 160 } } } as never))
    act(() => renderer.unmount())
    await hydrateChatDockHeight()
    expect(firstFrameHeight()).toBe(160)
  })
})
