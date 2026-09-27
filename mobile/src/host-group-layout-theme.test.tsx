import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The host group's layout (`app/h/_layout.tsx`) in both themes: the row behind the tablet split
 * view, the sidebar's divider, and the canvas every host screen's navigator paints before the
 * screen itself draws. It painted from the LEGACY static palette (`mobile-theme.ts`), dark-only,
 * until the 2026-09-27 sweep, so a screen transition in a light session flashed the dark canvas.
 */

vi.mock('react-native', () => ({
  PanResponder: { create: () => ({ panHandlers: {} }) },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('expo-router', () => {
  const Stack = ({ screenOptions, children }: { screenOptions: unknown; children: ReactNode }) =>
    createElement('Stack', { screenOptions }, children)
  Stack.Screen = () => null
  return {
    Stack,
    useGlobalSearchParams: () => ({ hostId: 'host-1' }),
    usePathname: () => '/h/host-1/session/wt-1'
  }
})
// A tablet, so the sidebar and its divider are on screen.
vi.mock('./layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isWideLayout: true, width: 1200 })
}))
vi.mock('./components/HostProtocolGate', () => ({
  HostProtocolGate: ({ children }: { children: ReactNode }) => children
}))
vi.mock('./host-screen/HostScreen', () => ({ HostScreen: () => null }))

import HostGroupLayout from '../app/h/_layout'
import { ThemeProvider } from './theme/theme-context'
import { darkColors, lightColors } from './theme/tokens'

function flat(style: unknown): Record<string, unknown> {
  const list = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign(
    {},
    ...list.filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
    )
  )
}

describe('the host group layout', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)(
    'paints the split row, sidebar divider and screen canvas from the %s theme',
    async (scheme, palette) => {
      await act(async () => {
        renderer = create(
          <ThemeProvider initialPreference={scheme}>
            <HostGroupLayout />
          </ThemeProvider>
        )
      })
      const root = renderer!.root
      const [row, sidebar] = root.findAll((node) => String(node.type) === 'View')
      expect(flat(row!.props.style).backgroundColor).toBe(palette.bg)
      expect(flat(sidebar!.props.style).borderRightColor).toBe(palette.border)
      const stack = root.find((node) => String(node.type) === 'Stack')
      expect(stack.props.screenOptions.contentStyle.backgroundColor).toBe(palette.bg)
    }
  )
})
