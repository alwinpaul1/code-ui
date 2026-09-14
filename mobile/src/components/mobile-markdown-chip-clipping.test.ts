import { describe, expect, it, vi } from 'vitest'

// makeMarkdownStyles calls StyleSheet.create; the real react-native entry is
// Flow-typed and this runner cannot parse it.
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
import { darkColors, fontFamily, lightColors, radius, space, type } from '../theme/tokens'
import type { Theme } from '../theme/theme-context'
import {
  MARKDOWN_INLINE_CHIP_BASELINE_SHIFT,
  makeMarkdownStyles
} from './mobile-markdown-styles'

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

type Box = {
  paddingTop?: number
  paddingBottom?: number
  paddingVertical?: number
  transform?: { translateY?: number }[]
}

describe('an inline code chip inside a table', () => {
  it.each(['dark', 'light'] as const)('is not sliced off by the table clip in %s', (scheme) => {
    // 2026-09-14, from the phone: a `54;1H` chip in a table row lost its top
    // and bottom. The chip is PAINTED lower than it is laid out so it sits
    // level with the text around it, and the table needs overflow:hidden for
    // its rounded corners — so the cell has to leave room for that shift.
    const styles = makeMarkdownStyles(themeFor(scheme)) as unknown as {
      tableCell: Box
      inlineCodeChip: Box
    }
    const shift = styles.inlineCodeChip.transform?.find(
      (entry) => entry.translateY !== undefined
    )?.translateY
    expect(shift).toBe(MARKDOWN_INLINE_CHIP_BASELINE_SHIFT)
    const cell = styles.tableCell
    // A single paddingVertical cannot express this: the room is only needed below.
    expect(cell.paddingVertical).toBeUndefined()
    expect((cell.paddingBottom ?? 0) - (cell.paddingTop ?? 0)).toBeGreaterThanOrEqual(
      MARKDOWN_INLINE_CHIP_BASELINE_SHIFT
    )
  })
})
