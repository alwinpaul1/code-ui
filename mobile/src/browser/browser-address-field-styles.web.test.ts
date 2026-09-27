import { describe, expect, it, vi } from 'vitest'

// StyleSheet.create is identity in React Native and on RN Web alike, and every other export of the
// module reaches the native runtime this test does not have.
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles }
}))

// The seam as the page bundle resolves it. Without this the `.web.ts` styles below would read the
// native seam and the test would pass on a size that no browser ever renders.
vi.mock(
  '../platform/text-input-font-size',
  async () => await import('../platform/text-input-font-size.web')
)

import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'
import { typography } from '../theme/mobile-theme'
import { syntaxPaletteForScheme } from '../theme/syntax-palette'
import { colorsForScheme, fontFamily, radius, space, type } from '../theme/tokens'
import type { Theme } from '../theme/theme-context'
import { browserAddressFieldBase } from './browser-address-field-base-styles'
import { browserAddressFieldStyles } from './browser-address-field-styles'
import { browserAddressFieldStyles as browserAddressFieldStylesOnWeb } from './browser-address-field-styles.web'
import { mobileBrowserPaneStyles } from './mobile-browser-pane-styles'

/** Below this an iOS browser zooms the page when an input takes focus, and does not zoom back. */
const IOS_FOCUS_ZOOM_FLOOR = 16

// These moved from static objects to factories of the live theme (the 2026-09-27 theme sweep);
// this file only reads sizes, which do not vary by scheme, so one fixed theme stands in.
const TEST_THEME: Theme = {
  scheme: 'dark',
  preference: 'dark',
  setPreference: () => undefined,
  colors: colorsForScheme('dark'),
  syntax: syntaxPaletteForScheme('dark'),
  space,
  radius,
  type,
  fonts: fontFamily,
  isDark: true
}
const nativeAddress = browserAddressFieldStyles(TEST_THEME)
const webAddress = browserAddressFieldStylesOnWeb(TEST_THEME)
const base = browserAddressFieldBase(TEST_THEME)
const pane = mobileBrowserPaneStyles(TEST_THEME)

describe('the browser pane text inputs on the web', () => {
  it('raises the address field to the seam, above the focus-zoom floor', () => {
    expect(webAddress.input.fontSize).toBe(TEXT_INPUT_FONT_SIZE)
    expect(webAddress.input.fontSize).toBeGreaterThanOrEqual(IOS_FOCUS_ZOOM_FLOOR)
    // A raise rather than the same number twice: the native seam is the app's body size.
    expect(TEXT_INPUT_FONT_SIZE).toBeGreaterThan(typography.bodySize)
  })

  it('raises the key row input to the same seam', () => {
    expect(pane.keyboardInput.fontSize).toBe(TEXT_INPUT_FONT_SIZE)
    expect(pane.keyboardInput.fontSize).toBeGreaterThanOrEqual(IOS_FOCUS_ZOOM_FLOOR)
  })

  it('keeps the overlaid label on the input size, so focus does not resize the address', () => {
    expect(webAddress.fileLabel.fontSize).toBe(webAddress.input.fontSize)
    expect(webAddress.fileLabel.lineHeight).toBe(webAddress.input.lineHeight)
  })

  it('gives the raised size a line box it fits in', () => {
    expect(webAddress.input.lineHeight).toBeGreaterThanOrEqual(webAddress.input.fontSize)
  })
})

describe('the browser address field natively', () => {
  it('renders at exactly the size it did before the split', () => {
    expect(nativeAddress.input.fontSize).toBe(typography.metaSize)
    expect(nativeAddress.input.fontSize).toBe(12)
    expect(nativeAddress.input.lineHeight).toBe(16)
    expect(nativeAddress.fileLabel.fontSize).toBe(12)
    expect(nativeAddress.fileLabel.lineHeight).toBe(16)
  })

  // The split is one value, not a second style: everything the siblings do not differ on comes from
  // the same object, so a padding or a colour cannot drift between the platforms.
  it('differs from the web style in nothing but the size', () => {
    expect(base.input).not.toHaveProperty('fontSize')
    expect(base.input).not.toHaveProperty('lineHeight')
    expect(nativeAddress.input).toMatchObject(base.input)
    expect(webAddress.input).toMatchObject(base.input)
    expect(nativeAddress.fileLabel).toMatchObject(base.fileLabel)
    expect(webAddress.fileLabel).toMatchObject(base.fileLabel)
  })
})
