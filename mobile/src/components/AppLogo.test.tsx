import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { contrastRatio } from '../test/contrast'
import { ThemeProvider } from '../theme/theme-context'
import { brand, darkColors, lightColors, type ThemePreference } from '../theme/tokens'
import { AppLogo } from './AppLogo'
import { APP_LOGO_PATH, APP_LOGO_VIEWBOX_HEIGHT, APP_LOGO_VIEWBOX_WIDTH } from './app-logo-path'

vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('react-native', () => ({ useColorScheme: () => 'light' }))

describe('the brand mark', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(element: ReactElement): ReactTestRenderer {
    act(() => {
      renderer = create(element)
    })
    return renderer!
  }

  function themed(preference: ThemePreference, props: { size?: number; color?: string } = {}) {
    return render(
      createElement(ThemeProvider, { initialPreference: preference }, createElement(AppLogo, props))
    )
  }

  it('draws the tile with the knot cut through it, one path', () => {
    const tree = render(createElement(AppLogo))
    const path = tree.root.findByType('Path')
    expect(path.props.d).toBe(APP_LOGO_PATH)
    // One closed outline: the knot is concavity in the tile, not holes, so a
    // single fill colour is the whole mark.
    expect(tree.root.findAllByType('Path')).toHaveLength(1)
    expect(APP_LOGO_PATH.startsWith('M ')).toBe(true)
    expect(APP_LOGO_PATH.endsWith(' Z')).toBe(true)
    expect(APP_LOGO_PATH).toContain(' A 181 181 ')
  })

  it('lets a caller tint the tile with the color prop', () => {
    const tree = render(createElement(AppLogo, { color: '#336699' }))
    expect(tree.root.findByType('Path').props.fill).toBe('#336699')
  })

  // 2026-10-11: the launcher icon went black with a white knot (option E), and
  // the user asked for the in-app mark to follow: black in light mode, white
  // in dark mode, where a black tile would vanish. The knot is cut through, so
  // the canvas shows in it and the mark reads as tile-plus-knot in both.
  it('is black in light mode and white in dark mode, and reads on every surface', () => {
    for (const [preference, expected] of [
      ['light', brand.markLight],
      ['dark', brand.markDark]
    ] as const) {
      const tree = themed(preference)
      expect(tree.root.findByType('Path').props.fill, preference).toBe(expected)
      act(() => tree.unmount())
      renderer = null
    }
    expect(brand.markLight).toBe('#141414')
    expect(brand.markDark).toBe('#FFFFFF')
    for (const [scheme, colors, mark] of [
      ['light', lightColors, brand.markLight],
      ['dark', darkColors, brand.markDark]
    ] as const) {
      for (const surface of [colors.bg, colors.bgPanel, colors.bgRaised]) {
        expect(contrastRatio(mark, surface), `${scheme} ${surface}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('scales by height and keeps the tile aspect at every call site size', () => {
    // 48 on About, 44 in the empty state, 40 on pair-confirm, 22 on onboarding,
    // 20 in the top bar, 14 in the notification preview.
    for (const size of [48, 44, 40, 22, 20, 14]) {
      const tree = render(createElement(AppLogo, { size }))
      const svg = tree.root.findByType('Svg')
      expect(svg.props.height).toBe(size)
      expect(svg.props.width).toBeCloseTo(
        (size * APP_LOGO_VIEWBOX_WIDTH) / APP_LOGO_VIEWBOX_HEIGHT,
        6
      )
      expect(svg.props.viewBox).toBe(`0 0 ${APP_LOGO_VIEWBOX_WIDTH} ${APP_LOGO_VIEWBOX_HEIGHT}`)
      act(() => tree.unmount())
      renderer = null
    }
  })

  it('is labelled for the app the user installed, not for Orca', () => {
    const tree = render(createElement(AppLogo))
    expect(tree.root.findByType('Svg').props.accessibilityLabel).toBe('Code UI')
  })
})
