import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider, useTheme } from '../theme/theme-context'
import { MobileNativeChatChromeRow } from './MobileNativeChatChromeRow'
import { makeChatViewStyles } from './mobile-native-chat-view-styles'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('./MobileNativeChatStatusLine', () => ({
  MobileNativeChatStatusLine: 'MobileNativeChatStatusLine'
}))
vi.mock('lucide-react-native', () => ({
  ChevronsDownUp: 'ChevronsDownUp',
  ChevronsUpDown: 'ChevronsUpDown',
  Square: 'Square'
}))

// 2026-10-02 (screenshot): the red "Couldn't open <file>" line sat over the assistant's text and
// the Tools row. The dock draws no ground by design (mobile-native-chat-dock-glass.test.ts), so the
// line itself needs an opaque surface of its own. dangerSoft is translucent in both schemes and
// would still let the text through, so the surface is bgRaised, as FloatingToast uses.
const message = "Couldn't open reports/draft.pdf: binary files don't open on the phone"

function Row() {
  const theme = useTheme()
  return createElement(MobileNativeChatChromeRow, {
    toolsExpanded: false,
    onToggleTools: () => {},
    sendErrorMessage: message,
    styles: makeChatViewStyles(theme)
  })
}

function flatten(style: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const walk = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      entry.forEach(walk)
    } else if (entry && typeof entry === 'object') {
      Object.assign(out, entry)
    }
  }
  walk(style)
  return out
}

describe('the failure line above the composer', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function surfaceBehindText(scheme: 'light' | 'dark'): Record<string, unknown> | undefined {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <Row />
        </ThemeProvider>
      )
    })
    const alert = renderer!.root.findAll(
      (node) => String(node.type) === 'View' && node.props.accessibilityRole === 'alert'
    )[0]
    const text = alert.findAll((node) => String(node.type) === 'Text')[0]
    // The nearest View around the text that paints something.
    let node = text.parent
    while (node && node !== alert.parent) {
      const style = flatten(node.props.style)
      if (String(node.type) === 'View' && style.backgroundColor) {
        return style
      }
      node = node.parent
    }
    return undefined
  }

  it('sits on an opaque surface so the chat text does not show through, in light', () => {
    const surface = surfaceBehindText('light')
    expect(surface?.backgroundColor).toBe(lightColors.bgRaised)
    expect(surface?.borderColor).toBe(lightColors.border)
  })

  it('sits on an opaque surface so the chat text does not show through, in dark', () => {
    const surface = surfaceBehindText('dark')
    expect(surface?.backgroundColor).toBe(darkColors.bgRaised)
    expect(surface?.borderColor).toBe(darkColors.border)
  })
})
