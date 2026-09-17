import { describe, expect, it } from 'vitest'
import { darkColors, lightColors } from '../../theme/tokens'

/**
 * A separator is the one part of an alert whose whole job is to be SEEN. Ours
 * used `colors.border`, which is tuned to sit quietly against the app's opaque
 * panels — against the alert's own material it measures 1.03:1 in dark, so the
 * rows ran together into one block with no division at all (reported from the
 * phone 2026-09-17, against BitChord's dialog where they are obvious).
 *
 * Asserting the ALPHA and the channel rather than a contrast ratio, because the
 * alert material is translucent: whatever shows through it changes the real
 * contrast, and a fixed ratio would be a number that is only true over one
 * backdrop. A light overlay on a dark material and a dark overlay on a light one
 * lift or drop by a fixed amount over anything, which is what iOS does and the
 * reason its separators survive over wallpaper.
 */
function parseRgba(value: string): { r: number; g: number; b: number; a: number } {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(value)
  if (!match) {
    throw new Error(`not an rgba colour: ${value}`)
  }
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4])
  }
}

describe('the alert separator', () => {
  it('is a translucent overlay, not an opaque palette colour', () => {
    for (const colors of [darkColors, lightColors]) {
      const separator = parseRgba(colors.alertSeparator)
      expect(separator.a).toBeGreaterThan(0)
      expect(separator.a).toBeLessThan(1)
    }
  })

  it('lifts on the dark material and drops on the light one', () => {
    // White over a dark card, black over a light one: the direction that makes
    // a line visible, whichever way round the scheme is.
    expect(parseRgba(darkColors.alertSeparator).r).toBe(255)
    expect(parseRgba(lightColors.alertSeparator).r).toBe(0)
  })

  it('is stronger than the row-pressed wash, which is a fill and not a line', () => {
    // A 1px line needs more alpha than a full-row tint to read at the same
    // strength. Getting these the same way round is how the separator vanished.
    for (const colors of [darkColors, lightColors]) {
      expect(parseRgba(colors.alertSeparator).a).toBeGreaterThan(
        parseRgba(colors.alertRowPressed).a
      )
    }
  })

  // Degenerate: the token must exist in BOTH schemes. A missing one renders as
  // `undefined`, which React Native treats as "no border colour" and draws
  // black — invisible on the dark card and wrong on the light one.
  it.each([
    ['dark', darkColors],
    ['light', lightColors]
  ])('is defined for %s', (_name, colors) => {
    expect(typeof colors.alertSeparator).toBe('string')
  })
})
