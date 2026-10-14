import type { ThemeScheme } from '../theme/tokens'

/**
 * The colours and type of the Claude app's diff, for the Changes review screen.
 *
 * Read from com.anthropic.claude 1.261009.20 (jadx, 2026-10-14). Every value names its class and
 * line so a later build can be compared against it:
 *
 * - Row tints, the 1 dp edge marker and the highlighted row are `mng` fields `b` to `f`, handed out
 *   by `l59.a` (`l59.java:61-66`; `l59.b` is the dark set, `l59.c` the light one, the same test
 *   `ty20.g` that `jlc.e` uses to pick its two blues). They are the `mng` constructor's 10th to
 *   14th arguments (`mng.java:18-22`).
 * - The expander row's two blues are literals in `jlc.e` (`jlc.java:11483-11484`): 4280165941
 *   and 4280628292 dark, 4294113277 and 4293325307 light.
 * - The +N / -M count of a file is `ad5.K()` and `ad5.u()` (`jlc.b`, `jlc.java:292` and `:306`).
 *
 * Why a module of its own and not `tokens.ts`: that file is shared by every screen and changes
 * hands one batch at a time; these values belong to one surface. A component reads them as
 * `mobileDiffPaletteForScheme(useTheme().scheme)`, so a row cannot draw one scheme's tint on the
 * other's page.
 */
export type MobileDiffPalette = {
  /** An added row: `mng.b`. */
  addBg: string
  /** The 1 dp bar at an added row's left edge: `mng.c` (`jlc.c` draws it through `cg0` case 12, `jlc.java:623`). */
  addMarker: string
  /** A removed row: `mng.d`. */
  delBg: string
  /** The bar at a removed row's left edge: `mng.e`. */
  delMarker: string
  /** A row that carries a comment: `mng.f` (yellow in light, brown in dark). */
  commentedBg: string
  /** The expander row's gutter cell (`jE2` in `jlc.e`). */
  gapGutterBg: string
  /** The expander row's label cell (`jE` in `jlc.e`). */
  gapBg: string
  /** "+N" of a file's change count: `ad5.K()`. */
  statAdd: string
  /** "-M": `ad5.u()`. */
  statDel: string
  /** The "N comments" chip: `pl7.O`, the primary text colour, at 10% (`o330.b`, `o330.java:51`). */
  chipBg: string
}

const darkPalette: MobileDiffPalette = {
  addBg: '#13271F',
  addMarker: '#2F7613',
  delBg: '#26181D',
  delMarker: '#B53333',
  commentedBg: '#3D301A',
  gapGutterBg: '#253444',
  gapBg: '#1E2635',
  statAdd: '#0CA30C',
  statDel: '#EC7E7E',
  // #F9F9F7 at 10%.
  chipBg: 'rgba(249, 249, 247, 0.1)'
}

const lightPalette: MobileDiffPalette = {
  addBg: '#EBF4E1',
  addMarker: '#2F7614',
  delBg: '#F9ECEC',
  delMarker: '#B53233',
  commentedBg: '#FFF8C5',
  gapGutterBg: '#E6F1FB',
  gapBg: '#F2F7FD',
  statAdd: '#006300',
  statDel: '#8E2626',
  // #131313 at 10%.
  chipBg: 'rgba(19, 19, 19, 0.1)'
}

export function mobileDiffPaletteForScheme(scheme: ThemeScheme): MobileDiffPalette {
  return scheme === 'dark' ? darkPalette : lightPalette
}

/**
 * The diff's type, in sp. Gutter text is `zv.i` (13 sp, line height 1.5 em, the code face, left to
 * right); the code itself is drawn at `x19.a`, 14 sp (`x19.java:7`). Both rows share one line
 * height so the gutter and the code agree: 1.5 x 13 = 19.5.
 */
export const MOBILE_DIFF_TYPE = {
  gutterSize: 13,
  codeSize: 14,
  lineHeight: 19.5,
  /** The expander row's "+N lines" is the same `zv.i` style as the gutter. */
  gapLabelSize: 13
} as const

/** The edge marker's width: `cg0` case 12 strokes `B0(1.0f)`. */
export const MOBILE_DIFF_MARKER_WIDTH = 1

/** The code starts 10 dp after the gutter's divider (`rrb.S(pwlVar5, 10.0f, ..)`, `jlc.java:687`). */
export const MOBILE_DIFF_CODE_START_PADDING = 10

/** JetBrains Mono, the bundled code face, advances 0.6 em. */
const MONO_ADVANCE_EM = 0.6

/**
 * The gutter's width, as `jlc.h` measures it (`jlc.java:11873`): the widest label a line could carry, a "+" and
 * three digits at least (more for a file whose last line number is longer), set in the gutter
 * style, plus 6 dp. The app measures the glyphs; a monospace face lets this do it by the em.
 */
export function mobileDiffGutterWidth(lastLineNumber: number): number {
  const digits = Math.max(3, String(Math.max(0, Math.trunc(lastLineNumber))).length)
  return Math.ceil((1 + digits) * MOBILE_DIFF_TYPE.gutterSize * MONO_ADVANCE_EM) + 6
}
