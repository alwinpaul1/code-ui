import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { darkColors, lightColors } from '../theme/tokens'
import { colors as legacyDarkPalette } from '../theme/mobile-theme'

function channelLuminance(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  return (
    0.2126 * channelLuminance(Number.parseInt(hex.slice(1, 3), 16)) +
    0.7152 * channelLuminance(Number.parseInt(hex.slice(3, 5), 16)) +
    0.0722 * channelLuminance(Number.parseInt(hex.slice(5, 7), 16))
  )
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

const WCAG_AA_BODY = 4.5

/**
 * The onboarding shell follows the appearance setting — `mobile-onboarding.tsx`
 * paints its container with `colors.bg` from `useTheme()`. The page inside it
 * must follow the same setting, or the two disagree and the text lands on a
 * background it was never coloured for.
 *
 * Measured before this test existed: the page drew its title with the LEGACY
 * dark-only palette (`textPrimary` #ECE9E2) while the shell painted light
 * (#F3F1EA) — 1.07:1, invisible. Body text was 1.83:1. Both pass on dark
 * (14.49:1 and 8.50:1), which is why every automated check stayed green and
 * only a light-mode reader would have seen it.
 *
 * The existing `mobile-theme-contrast.test.ts` could not catch this: it pairs
 * the legacy palette only with dark surfaces, so it never tests the
 * combination the app actually renders.
 */
describe('onboarding stays readable in the theme the user chose', () => {
  /** Swept rather than spot-fixed: the page was found drawing from the legacy
   *  palette, and the brand-new preview component imported it too. One file at a
   *  time would have shipped a dark-only component into the screen being fixed,
   *  so every onboarding module that RENDERS is checked. `mobile-onboarding-styles`
   *  is excluded on purpose — it is the static sheet whose colour values these
   *  components override. */
  const RENDERING_MODULES = [
    'MobileOnboardingPage.tsx',
    'NotificationOnboardingPreview.tsx'
  ]

  it.each(RENDERING_MODULES)('does not draw %s from the legacy dark-only palette', (module) => {
    const source = readFileSync(join(__dirname, module), 'utf8')
    // Why source-reading: the defect is WHICH palette the module imports. A
    // render assertion cannot see an import, and the colours look correct in
    // dark mode either way.
    // Only `colors` is the defect: radii/spacing/typography from the same
    // module carry no appearance and are fine to keep importing.
    const legacyImport = source.match(/import \{([^}]*)\} from '\.\.\/theme\/mobile-theme'/)
    expect(legacyImport?.[1] ?? '').not.toMatch(/\bcolors\b/)
  })

  it('does not leave the route painting its progress dots from the legacy palette', () => {
    const route = readFileSync(join(__dirname, '..', '..', 'app', 'mobile-onboarding.tsx'), 'utf8')
    // `progressDotActive` is `colors.textPrimary` in the static sheet — near-white,
    // and invisible on the light background this same file paints. The route must
    // colour the dots from the palette it already reads via useTheme().
    expect(route).not.toMatch(/styles\.progressDotActive/)
    expect(route).toMatch(/index === activeIndex && \{ backgroundColor: colors\.text \}/)
  })

  it('keeps body text readable on both backgrounds the shell can paint', () => {
    for (const [scheme, palette] of [
      ['light', lightColors],
      ['dark', darkColors]
    ] as const) {
      expect(
        contrastRatio(palette.text, palette.bg),
        `${scheme}: title on shell background`
      ).toBeGreaterThanOrEqual(WCAG_AA_BODY)
      expect(
        contrastRatio(palette.textMuted, palette.bg),
        `${scheme}: body and disclosure on shell background`
      ).toBeGreaterThanOrEqual(WCAG_AA_BODY)
    }
  })

  /** The measurement that made this a bug rather than a worry: the legacy
   *  palette is fine on its own surface and unusable on the light one, so any
   *  screen mixing it with the themed shell is broken in light mode. */
  it('records why the legacy palette cannot be mixed with the themed shell', () => {
    expect(contrastRatio(legacyDarkPalette.textPrimary, darkColors.bg)).toBeGreaterThan(WCAG_AA_BODY)
    expect(contrastRatio(legacyDarkPalette.textPrimary, lightColors.bg)).toBeLessThan(2)
  })
})
