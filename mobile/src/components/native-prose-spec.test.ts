import { describe, expect, it } from 'vitest'
import { darkColors, fontFamily, lightColors } from '../theme/tokens'
import { parseMobileMarkdown } from './mobile-markdown-parser'
import { buildProseRuns, type ProseBlock } from './mobile-markdown-prose-runs'
import {
  MARKDOWN_CHIP_BORDER_WIDTH,
  MARKDOWN_CHIP_PADDING_HORIZONTAL,
  MARKDOWN_CHIP_RADIUS,
  TRANSCRIPT_MARKDOWN_TYPOGRAPHY
} from './mobile-markdown-prose-scale'
import { buildNativeProseModel } from './native-prose-model'
import { nativeProseHeightDp, nativeProseLayoutWidth, nativeProseSpec } from './native-prose-spec'

// What modules/orca-native-prose is handed (NativeProseSpec.kt parses this
// shape). The colours are the theme's own, light and dark both required
// states: a literal here would draw every reply in one scheme forever while
// every other check stayed green.

const model = buildNativeProseModel(
  buildProseRuns(parseMobileMarkdown('Run `pnpm test` and see [docs](https://x.y).'), () => false)[0]!
    .prose as ProseBlock[],
  { typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY, opensFiles: false }
)!

/** Stands in for processColor: names each colour so a test can see which
 *  theme entry landed in which slot. */
function tagged(palette: Record<string, string>) {
  // Several entries can share a value (text and userBubbleText do), so a
  // value names every entry it could be.
  const names = new Map<string, string[]>()
  for (const [name, value] of Object.entries(palette)) {
    names.set(value, [...(names.get(value) ?? []), name])
  }
  const seen: string[][] = []
  return {
    seen,
    toColor(value: string): number {
      seen.push(names.get(value) ?? [`literal:${value}`])
      return seen.length
    }
  }
}

describe('the spec the native prose view is drawn from', () => {
  for (const [scheme, colors] of [
    ['light', lightColors],
    ['dark', darkColors]
  ] as const) {
    it(`takes every colour from the ${scheme} theme`, () => {
      const colorTags = tagged(colors as unknown as Record<string, string>)
      const spec = JSON.parse(
        nativeProseSpec(model, {
          typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY,
          scale: 1,
          colors,
          fonts: fontFamily,
          toColor: colorTags.toColor
        })
      )
      expect(colorTags.seen.flat().some((name) => name.startsWith('literal:'))).toBe(false)
      const slot = (key: string) => colorTags.seen[spec.colors[key] - 1]
      expect(slot('text')).toContain('text')
      expect(slot('link')).toContain('accentText')
      expect(slot('codeText')).toContain('codeSpanText')
      expect(slot('codeBackground')).toContain('codeSpanBg')
      expect(slot('codeBorder')).toContain('codeSpanBorder')
      expect(slot('rule')).toContain('border')
      expect(slot('marker')).toContain('text')
    })
  }

  it('carries the model, the zoom, the faces and the pill as the native side reads them', () => {
    const spec = JSON.parse(
      nativeProseSpec(model, {
        typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY,
        scale: 1.25,
        colors: lightColors,
        fonts: fontFamily,
        toColor: () => 0
      })
    )
    expect(spec.model).toEqual(model)
    expect(spec.scale).toBe(1.25)
    expect(spec.fontSize).toBe(TRANSCRIPT_MARKDOWN_TYPOGRAPHY.prose.fontSize)
    expect(spec.fonts).toEqual({ regular: fontFamily.regular, bold: fontFamily.semibold, mono: fontFamily.mono })
    expect(spec.chip).toEqual({
      fontSize: TRANSCRIPT_MARKDOWN_TYPOGRAPHY.chip.fontSize,
      lineHeight: TRANSCRIPT_MARKDOWN_TYPOGRAPHY.chip.lineHeight,
      paddingHorizontal: MARKDOWN_CHIP_PADDING_HORIZONTAL,
      borderWidth: MARKDOWN_CHIP_BORDER_WIDTH,
      radius: MARKDOWN_CHIP_RADIUS
    })
  })

  it('lays the text out no wider than the pixels the view can get', () => {
    // Fabric gives a view floor or ceil of its width in pixels; the floor is
    // what the measure and the drawn text both use.
    expect(nativeProseLayoutWidth(392.7, 2.625)).toBe(1030)
    expect(nativeProseLayoutWidth(0, 3)).toBe(0)
    expect(nativeProseLayoutWidth(-4, 3)).toBe(0)
  })

  it('gives the view a pixel more than the text so no descender is clipped by rounding', () => {
    expect(nativeProseHeightDp(630, 3)).toBeCloseTo(631 / 3)
    // A measure that failed draws nothing native: the caller falls back.
    expect(nativeProseHeightDp(-1, 3)).toBeNull()
  })
})
