import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  useColorScheme: () => 'light'
}))
// Why: the drawer is a native modal stack; the sheet's own colours are what is under test.
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ children }: { children: unknown }) => children
}))
// Why: expo-secure-store reaches for expo-modules-core's native EventEmitter, which
// does not exist once 'react-native' is a handful of host tags.
vi.mock('./mac-unlock-password-store', () => ({
  writeMacUnlockPassword: vi.fn(),
  clearMacUnlockPassword: vi.fn()
}))

import { ThemeProvider } from '../theme/theme-context'
import { MacHostToast } from './MacHostToast'
import { MacUnlockPasswordSheet } from './MacUnlockPasswordSheet'

function renderInScheme(scheme: 'light' | 'dark', element: ReturnType<typeof createElement>) {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(createElement(ThemeProvider, { initialPreference: scheme }, element))
  })
  return renderer!
}

function backgroundsOf(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((node) => typeof node.props?.style === 'object' && node.props.style !== null)
    .flatMap((node) => {
      const style = node.props.style as Record<string, unknown>
      return typeof style.backgroundColor === 'string' ? [style.backgroundColor] : []
    })
}

describe('the Mac controls in both themes', () => {
  it('paints the toast from the live theme, not one fixed palette', () => {
    const light = backgroundsOf(renderInScheme('light', createElement(MacHostToast, { message: 'Locking the Mac…' })))
    const dark = backgroundsOf(renderInScheme('dark', createElement(MacHostToast, { message: 'Locking the Mac…' })))
    expect(light.length).toBeGreaterThan(0)
    expect(dark).not.toEqual(light)
  })

  it('paints the password sheet from the live theme too', () => {
    const props = {
      hostId: 'host-1',
      hostName: 'Studio',
      onClose: vi.fn(),
      onSaved: vi.fn()
    }
    const light = backgroundsOf(renderInScheme('light', createElement(MacUnlockPasswordSheet, props)))
    const dark = backgroundsOf(renderInScheme('dark', createElement(MacUnlockPasswordSheet, props)))
    expect(light.length).toBeGreaterThan(0)
    expect(dark).not.toEqual(light)
  })

  it('warns that the password lives on the phone and travels to the Mac', () => {
    const renderer = renderInScheme(
      'light',
      createElement(MacUnlockPasswordSheet, {
        hostId: 'host-1',
        hostName: 'Studio',
        onClose: vi.fn(),
        onSaved: vi.fn()
      })
    )
    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('stored on this phone')
    expect(text).toContain('sent to the Mac')
  })
})
