import type { ThemeColors, fontFamily } from '../theme/tokens'
import {
  MARKDOWN_CHIP_BORDER_WIDTH,
  MARKDOWN_CHIP_PADDING_HORIZONTAL,
  MARKDOWN_CHIP_RADIUS,
  type MarkdownTypography
} from './mobile-markdown-prose-scale'
import type { NativeProseModel } from './native-prose-model'

/**
 * The JSON modules/orca-native-prose draws a prose run from (NativeProseSpec.kt parses it): the
 * model, the reader's zoom, the faces, the pill's shape and the theme's colours, each colour as the
 * Android int React Native's processColor gives. One string, so the synchronous measure and the
 * view are handed the very same thing, and a changed reply is a changed string.
 */
type Options = {
  typography: MarkdownTypography
  /** The reader's pinch zoom; the native side multiplies every size by it. */
  scale: number
  /** The current scheme's colours, light or dark (useTheme().colors). */
  colors: ThemeColors
  fonts: typeof fontFamily
  /** processColor, which is react-native's and so passed in. */
  toColor: (color: string) => number
}

export function nativeProseSpec(model: NativeProseModel, options: Options): string {
  const { typography, colors, fonts, toColor } = options
  return JSON.stringify({
    model,
    scale: options.scale,
    fontSize: typography.prose.fontSize,
    colors: {
      text: toColor(colors.text),
      link: toColor(colors.accentText),
      codeText: toColor(colors.codeSpanText),
      codeBackground: toColor(colors.codeSpanBg),
      codeBorder: toColor(colors.codeSpanBorder),
      rule: toColor(colors.border),
      // The Claude app's bullet is the words' own colour.
      marker: toColor(colors.text)
    },
    fonts: { regular: fonts.regular, bold: fonts.semibold, mono: fonts.mono },
    chip: {
      fontSize: typography.chip.fontSize,
      lineHeight: typography.chip.lineHeight,
      paddingHorizontal: MARKDOWN_CHIP_PADDING_HORIZONTAL,
      borderWidth: MARKDOWN_CHIP_BORDER_WIDTH,
      radius: MARKDOWN_CHIP_RADIUS
    }
  })
}

/** The width in whole pixels the text is measured and drawn at: the floor of the view's width,
 *  which Fabric's rounding never takes the view under. */
export function nativeProseLayoutWidth(widthDp: number, density: number): number {
  return widthDp > 0 ? Math.floor(widthDp * density) : 0
}

/** The view's height in dp for a text `heightPx` tall: one pixel over, so rounding the view's
 *  edges to the pixel grid never cuts the last line's descenders. Null when the measure failed. */
export function nativeProseHeightDp(heightPx: number, density: number): number | null {
  return heightPx >= 0 ? (heightPx + 1) / density : null
}
