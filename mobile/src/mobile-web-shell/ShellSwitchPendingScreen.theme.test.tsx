// The frame every route switch paints while the shell flag is read, in both themes. Upstream
// (#22077) paints it from the static dark palette. This fork draws it from the theme: on a
// development or OTA build it sits in front of every switched native screen, and those follow the
// appearance setting, so a hardcoded colour flashed a dark frame before each light one.

import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { ShellSwitchPendingScreen } from './ShellSwitchPendingScreen'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles },
  useColorScheme: () => 'light'
}))

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const raw = node.props.style
  const flat = (Array.isArray(raw) ? raw.flat() : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

describe('the frame a route switch holds while the shell flag is read', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints its canvas and spinner from the %s theme', (scheme, palette) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <ShellSwitchPendingScreen />
        </ThemeProvider>
      )
    })
    const [frame] = renderer!.root.findAllByType('View' as never)
    expect(styleOf(frame!).backgroundColor).toBe(palette.bg)
    const spinner = renderer!.root.findByType('ActivityIndicator' as never)
    expect(spinner.props.color).toBe(palette.textSecondary)
  })
})
