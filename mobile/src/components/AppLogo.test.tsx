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

  it('draws the tile with the knot cut through it, in the brand red', () => {
    const tree = render(createElement(AppLogo))
    const path = tree.root.findByType('Path')
    expect(path.props.d).toBe(APP_LOGO_PATH)
    expect(path.props.fill).toBe(brand.red)
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

  it('keeps the brand red in light and in dark, and reads on both canvases', () => {
    // The mark stopped following the text colour with the 2026-09-17 brand
    // refresh: an app icon is the same red on every wallpaper. What changes
    // between schemes is what shows through the knot, so the red must clear
    // 3:1 (WCAG non-text) on every surface it is drawn over in either scheme.
    for (const preference of ['light', 'dark'] as const) {
      const tree = themed(preference)
      expect(tree.root.findByType('Path').props.fill, preference).toBe(brand.red)
      act(() => tree.unmount())
      renderer = null
    }
    for (const [scheme, colors] of [
      ['light', lightColors],
      ['dark', darkColors]
    ] as const) {
      for (const surface of [colors.bg, colors.bgPanel, colors.bgRaised]) {
        expect(
          contrastRatio(brand.red, surface),
          `${scheme} ${surface}`
        ).toBeGreaterThanOrEqual(3)
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
