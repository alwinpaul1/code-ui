import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../test/contrast'
import { darkColors, lightColors } from './tokens'

// These two cases measured the static dark palette in mobile-theme.ts until it was deleted
// (2026-09-27). Its values were the dark scheme's, so the dark rows below are the same numbers;
// the light rows are the half it never measured.
describe('mobile text contrast', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('%s: keeps danger text readable on the chat failure pill (bgPanel)', (scheme, palette) => {
    expect(
      contrastRatio(palette.danger, palette.bgPanel),
      `${scheme}: danger ${palette.danger} on ${palette.bgPanel}`
    ).toBeGreaterThanOrEqual(4.5)
  })

  // The label of a destructive Button (the "Run" in the shell-command question, "Discard", "Delete")
  // was a literal #FFFFFF in both schemes: 5.4:1 on the light danger red, 3.25:1 on the dark one.
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('%s: keeps the label of a destructive button readable on the danger fill', (scheme, palette) => {
    expect(
      contrastRatio(palette.onDanger, palette.danger),
      `${scheme}: onDanger ${palette.onDanger} on danger ${palette.danger}`
    ).toBeGreaterThanOrEqual(4.5)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('%s: keeps muted text readable on every standard surface', (scheme, palette) => {
    for (const surface of [palette.bg, palette.bgPanel, palette.bgRaised]) {
      expect(
        contrastRatio(palette.textMuted, surface),
        `${scheme}: muted ${palette.textMuted} on ${surface}`
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('%s: keeps secondary text more prominent than muted text', (_scheme, palette) => {
    expect(contrastRatio(palette.textSecondary, palette.bgPanel)).toBeGreaterThan(
      contrastRatio(palette.textMuted, palette.bgPanel)
    )
  })
})

// The update card was a translucent material over a scrim over the page until
// the 2026-10-10 redesign made it solid ("not glass"). Its text is measured
// against what it is actually drawn on, in BOTH schemes, since the onboarding
// page shipped at 1.07:1 in light while every dark-only check stayed green
// (2026-09-16). The compositing helpers below also serve the diff checks.

type Rgb = { r: number; g: number; b: number }
type Rgba = Rgb & { a: number }

function parseColor(value: string): Rgba {
  const rgba = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === undefined ? 1 : Number(rgba[4])
    }
  }
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (!hex) {
    throw new Error(`not a colour this test can composite: ${value}`)
  }
  const n = Number.parseInt(hex[1]!, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
}

/** Source-over: `top` painted on an opaque `under`. */
function over(top: Rgba, under: Rgb): Rgb {
  return {
    r: Math.round(top.r * top.a + under.r * (1 - top.a)),
    g: Math.round(top.g * top.a + under.g * (1 - top.a)),
    b: Math.round(top.b * top.a + under.b * (1 - top.a))
  }
}

function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

const WCAG_AA_BODY = 4.5

describe('the update card stays readable on its own solid surface', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('%s: title, message, eyebrow, links and a failure all clear AA on the panel', (scheme, palette) => {
    const surface = palette.bgPanel
    for (const [name, foreground] of [
      ['title, version and notes', palette.text],
      ['message and notes', palette.textSecondary],
      ['meta line', palette.textMuted],
      ['eyebrow and links', palette.accentText],
      ['failure icon', palette.danger]
    ] as const) {
      expect(
        contrastRatio(foreground, surface),
        `${scheme}: ${name} (${foreground}) on ${surface}`
      ).toBeGreaterThanOrEqual(WCAG_AA_BODY)
    }
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('%s: the failure reason clears AA in its sunken box', (scheme, palette) => {
    for (const foreground of [palette.textSecondary, palette.textMuted]) {
      expect(contrastRatio(foreground, palette.bgSunken), `${scheme}: ${foreground}`).toBeGreaterThanOrEqual(
        WCAG_AA_BODY
      )
    }
  })

  it('dims with the same flat black in both schemes', () => {
    expect(lightColors.alertScrim).toBe('rgba(0, 0, 0, 0.28)')
    expect(darkColors.alertScrim).toBe(lightColors.alertScrim)
  })

  it('shows a pressed pill in both schemes: the press differs from the resting accent', () => {
    for (const [scheme, palette] of [
      ['light', lightColors],
      ['dark', darkColors]
    ] as const) {
      expect(palette.accentText, `${scheme}: pressed pill must not look like a resting one`).not.toBe(
        palette.accent
      )
      // The label stays at least as readable while pressed as at rest.
      expect(contrastRatio(palette.onAccent, palette.accentText)).toBeGreaterThanOrEqual(
        contrastRatio(palette.onAccent, palette.accent) * 0.9
      )
    }
  })
})

// Review of c714c9bc: the run row's "+A −R" pill draws each count on its own
// diff tint, and the diff card draws the same pair on the tint over `codeBg`
// (rows) and plain on `bgRaised` (header). In light, "+N" read 3.97:1 on its
// pill and 3.71:1 on a card row; "−N" 4.31:1 on a card row. Every place the
// pair is drawn, tinted or plain, on every surface a chat row, sheet or card
// sits on, in both schemes.
describe('diff line counts stay readable on their tints, pills and cards', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('%s: "+N" and "−N" clear AA tinted and plain on every surface', (_scheme, palette) => {
    for (const surface of [palette.bg, palette.bgPanel, palette.bgRaised, palette.codeBg]) {
      for (const [name, text, tint] of [
        ['+N', palette.diffAddText, palette.diffAddBg],
        ['−N', palette.diffDelText, palette.diffDelBg]
      ] as const) {
        const tinted = toHex(over(parseColor(tint), parseColor(surface)))
        expect({ name, surface, ratio: contrastRatio(text, tinted) >= WCAG_AA_BODY }).toEqual({
          name,
          surface,
          ratio: true
        })
        expect({ name, surface, plain: contrastRatio(text, surface) >= WCAG_AA_BODY }).toEqual({
          name,
          surface,
          plain: true
        })
      }
    }
  })
})
