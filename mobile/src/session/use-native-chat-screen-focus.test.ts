import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const router = vi.hoisted(() => ({ effect: null as (() => (() => void) | void) | null }))

// vitest.setup.ts stubs this hook for every test that draws the chat, since
// expo-router has no Node entry. This is the one test that runs it for real.
vi.unmock('./use-native-chat-screen-focus')
// expo-router's useFocusEffect: runs the effect when the screen gains focus and
// its cleanup when it loses it.
vi.mock('expo-router', () => ({
  useFocusEffect: (effect: () => (() => void) | void) => {
    router.effect = effect
  }
}))

import { useNativeChatScreenFocus } from './use-native-chat-screen-focus'

describe("the chat screen's navigation focus", () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('reports focus when the session screen gains it and blur when a pushed route covers it', () => {
    const reports: boolean[] = []
    function Screen() {
      useNativeChatScreenFocus((focused) => reports.push(focused))
      return null
    }
    act(() => {
      renderer = create(createElement(Screen))
    })
    const cleanup = router.effect?.()
    expect(reports).toEqual([true])
    if (typeof cleanup === 'function') {
      cleanup()
    }
    expect(reports).toEqual([true, false])
  })
})
