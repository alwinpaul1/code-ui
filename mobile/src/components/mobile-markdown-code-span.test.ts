import { describe, expect, it } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'

/**
 * Android draws a text selection BEHIND the text, so any opaque background on
 * an inline span paints over the highlight: reported 2026-09-12 with a
 * screenshot where a whole answer was selected and every `code` chip in it
 * read as the one thing left out. The chip stays visible, translucent enough
 * for the highlight to show through.
 */
describe('inline code chips inside selectable prose', () => {
  for (const [name, palette] of [
    ['light', lightColors],
    ['dark', darkColors]
  ] as const) {
    it(`is translucent in ${name} so a selection shows through it`, () => {
      const match = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)$/.exec(palette.codeSpanBg)
      expect(match, palette.codeSpanBg).not.toBeNull()
      expect(Number(match![1])).toBeLessThanOrEqual(0.2)
      expect(Number(match![1])).toBeGreaterThan(0)
    })

    it(`still reads as a chip in ${name}`, () => {
      // Distinct from every surface it sits on, and never fully transparent.
      for (const surface of [palette.bg, palette.bgPanel, palette.bgRaised, palette.userBubble]) {
        expect(palette.codeSpanBg).not.toBe(surface)
      }
      expect(palette.codeSpanBg).not.toBe('transparent')
    })
  }
})
