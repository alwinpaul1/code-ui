import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme, type Theme } from '../theme/theme-context'
import { makeChatViewStyles } from './mobile-native-chat-view-styles'

let scheme: 'light' | 'dark' = 'light'
vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T) => styles },
  useColorScheme: () => scheme
}))

// Reported 2026-10-11 with two screenshots side by side: the Claude app puts
// its ↓ "scroll to latest" button in the middle of the screen, just above the
// composer, and Code UI had it in the right-hand corner. The button is 40 wide,
// so its left edge sits at half the width less half its own.
function fabIn(next: 'light' | 'dark'): Record<string, unknown> {
  scheme = next
  let theme: Theme | null = null
  function Grab() {
    theme = useTheme()
    return null
  }
  act(() => {
    create(createElement(ThemeProvider, null, createElement(Grab)))
  })
  return makeChatViewStyles(theme!).fab as Record<string, unknown>
}

describe('the scroll-to-latest button', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`sits in the middle above the composer, not in the corner (${mode})`, () => {
      const fab = fabIn(mode)
      expect(fab.right).toBeUndefined()
      expect(fab.left).toBe('50%')
      expect(fab.marginLeft).toBe(-(fab.width as number) / 2)
    })
  }
})
