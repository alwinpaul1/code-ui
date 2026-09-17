import { describe, expect, it } from 'vitest'
import { colors } from './mobile-theme'
import { darkColors, lightColors, type ThemeColors } from './tokens'

function channelLuminance(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  return (
    0.2126 * channelLuminance(red) +
    0.7152 * channelLuminance(green) +
    0.0722 * channelLuminance(blue)
  )
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

describe('mobile text contrast', () => {
  it('keeps muted text readable on every standard dark surface', () => {
    for (const surface of [colors.bgBase, colors.bgPanel, colors.bgRaised]) {
      expect(contrastRatio(colors.textMuted, surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps secondary text more prominent than muted text', () => {
    expect(contrastRatio(colors.textSecondary, colors.bgPanel)).toBeGreaterThan(
      contrastRatio(colors.textMuted, colors.bgPanel)
    )
  })
})

// The update alert is a translucent material over a scrim over the page, so
// the surface its text lands on is none of the palette's flat colours. It is
// the composite, and that is what the text is measured against, in BOTH
// schemes, since the onboarding page shipped at 1.07:1 in light while every
// dark-only check stayed green (2026-09-16).

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

/** What the alert's text is actually drawn on: material over scrim over page. */
function alertSurface(palette: ThemeColors): string {
  const page = parseColor(palette.bg)
  const dimmed = over(parseColor(palette.alertScrim), page)
  return toHex(over(parseColor(palette.alertMaterial), dimmed))
}

const WCAG_AA_BODY = 4.5

describe('the update alert stays readable on its own frosted surface', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('%s: title, message, tinted rows and a destructive row all clear AA', (scheme, palette) => {
    const surface = alertSurface(palette)
    for (const [name, foreground] of [
      ['title and notes', palette.text],
      ['message and version line', palette.textSecondary],
      ['action rows and links', palette.accentText],
      ['destructive row', palette.danger]
    ] as const) {
      expect(
        contrastRatio(foreground, surface),
        `${scheme}: ${name} (${foreground}) on ${surface}`
      ).toBeGreaterThanOrEqual(WCAG_AA_BODY)
    }
  })

  it('dims with the same flat black in both schemes, as the alert spec asks', () => {
    expect(lightColors.alertScrim).toBe('rgba(0, 0, 0, 0.28)')
    expect(darkColors.alertScrim).toBe(lightColors.alertScrim)
  })

  it('shows a pressed row in both schemes: the highlight differs from the resting surface', () => {
    for (const [scheme, palette] of [
      ['light', lightColors],
      ['dark', darkColors]
    ] as const) {
      const resting = alertSurface(palette)
      const pressed = toHex(over(parseColor(palette.alertRowPressed), parseColor(resting)))
      expect(pressed, `${scheme}: pressed row must not look like a resting one`).not.toBe(resting)
      // Still readable while pressed.
      expect(contrastRatio(palette.accentText, pressed)).toBeGreaterThanOrEqual(WCAG_AA_BODY)
    }
  })
})
