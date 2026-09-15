import { describe, expect, it, vi } from 'vitest'

// makeMarkdownStyles calls StyleSheet.create; the real react-native entry is
// Flow-typed and this runner cannot parse it.
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
import { darkColors, fontFamily, lightColors, radius, space, type } from '../theme/tokens'
import type { Theme } from '../theme/theme-context'
import { MARKDOWN_BASE_SIZE, makeMarkdownStyles } from './mobile-markdown-styles'

function themeFor(scheme: 'light' | 'dark'): Theme {
  return {
    scheme,
    preference: scheme,
    setPreference: () => undefined,
    colors: scheme === 'dark' ? darkColors : lightColors,
    space,
    radius,
    type,
    fonts: fontFamily,
    isDark: scheme === 'dark'
  }
}

describe('markdown typography at phone width', () => {
  it.each(['light', 'dark'] as const)('steps heading sizes down by level in %s', (scheme) => {
    const styles = makeMarkdownStyles(themeFor(scheme)) as unknown as Record<
      string,
      { fontSize?: number; lineHeight?: number; color?: string }
    >
    const sizes = [
      styles.headingLevel1!.fontSize!,
      styles.headingLevel2!.fontSize!,
      styles.headingLevel3!.fontSize!,
      styles.heading!.fontSize!
    ]
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
    expect(new Set(sizes).size).toBe(sizes.length)
    // Even h4-h6 stay above body size, or a heading reads as a paragraph.
    expect(sizes.at(-1)!).toBeGreaterThan(MARKDOWN_BASE_SIZE)
  })

  it.each(['light', 'dark'] as const)('gives every heading room to breathe in %s', (scheme) => {
    const styles = makeMarkdownStyles(themeFor(scheme)) as unknown as Record<
      string,
      { fontSize?: number; lineHeight?: number }
    >
    for (const key of ['heading', 'headingLevel1', 'headingLevel2', 'headingLevel3']) {
      const style = styles[key]!
      const size = style.fontSize ?? styles.heading!.fontSize!
      expect(style.lineHeight!, key).toBeGreaterThanOrEqual(size + 6)
    }
  })

  it.each(['light', 'dark'] as const)('takes its heading colour from the theme in %s', (scheme) => {
    const styles = makeMarkdownStyles(themeFor(scheme)) as unknown as Record<
      string,
      { color?: string }
    >
    const palette = scheme === 'dark' ? darkColors : lightColors
    // A heading that hardcoded a colour would pass every other check here and
    // still ship the wrong theme.
    expect(styles.heading!.color).toBe(palette.text)
    expect(styles.headingLevel1!.color).toBeUndefined()
  })
})
