// The catch-all's refusal screen in both themes. Upstream (#21950) paints it from the static
// dark palette; this fork draws it from the theme, because on a store build (shell off) it is
// where any unrouted host path lands natively, so a hardcoded colour would ship the wrong mode.

import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { PageRouteUnavailableScreen } from './PageRouteUnavailableScreen'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
const replace = vi.fn()
vi.mock('../navigation/route-handoff', () => ({
  useRouteHandoff: () => ({ replace })
}))

function styleOf(node: { props: { style?: unknown } }, pressed = false): Record<string, unknown> {
  const raw = typeof node.props.style === 'function' ? node.props.style({ pressed }) : node.props.style
  const flat = (Array.isArray(raw) ? raw.flat() : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

describe('the page-route refusal screen', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    replace.mockClear()
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints its canvas, message and button from the %s theme', (scheme, palette) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <PageRouteUnavailableScreen hostId="host-1" />
        </ThemeProvider>
      )
    })
    const root = renderer!.root.findByProps({ testID: 'mobile-web-page-route-unavailable' })
    expect(styleOf(root).backgroundColor).toBe(palette.bg)
    const [message, label] = renderer!.root.findAllByType('Text' as never)
    expect(styleOf(message!).color).toBe(palette.text)
    expect(styleOf(label!).color).toBe(palette.text)
    const button = renderer!.root.findByProps({ accessibilityRole: 'button' })
    expect(styleOf(button).backgroundColor).toBe(palette.bgRaised)
  })

  it('leaves for the host list when the id is absent, and for the host otherwise', () => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference="dark">
          <PageRouteUnavailableScreen hostId="" />
        </ThemeProvider>
      )
    })
    const button = renderer!.root.findByProps({ accessibilityRole: 'button' })
    expect(button.props.accessibilityLabel).toBe('Back to hosts')
    act(() => button.props.onPress())
    expect(replace).toHaveBeenCalledWith('/')
  })
})
