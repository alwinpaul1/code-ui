import { useMemo } from 'react'
import { PixelRatio, StyleSheet } from 'react-native'
import { useTheme, type Theme } from '../theme/theme-context'

/** Base prose size; the chat view passes a textScale above 1 on top of it. */
import {
  MARKDOWN_BASE_SIZE,
  MARKDOWN_CHIP_BORDER_WIDTH,
  MARKDOWN_CHIP_FONT_SIZE,
  MARKDOWN_CHIP_LINE_HEIGHT,
  MARKDOWN_CHIP_PADDING_HORIZONTAL,
  MARKDOWN_CHIP_PADDING_VERTICAL,
  MARKDOWN_CHIP_RADIUS,
  MARKDOWN_TABLE_CELL_FONT_SIZE,
  MARKDOWN_TABLE_CELL_LINE_HEIGHT,
  MARKDOWN_TABLE_CELL_PADDING_BOTTOM,
  MARKDOWN_TABLE_CHIP_FONT_SIZE,
  MARKDOWN_TABLE_CHIP_LINE_HEIGHT,
  markdownChipBaselineShift,
  markdownChipInkRoom
} from './mobile-markdown-prose-scale'
export { MARKDOWN_BASE_SIZE } from './mobile-markdown-prose-scale'

/** How far an inline code chip is painted BELOW its layout box, so its text
 *  sits on the paragraph's baseline, or half a dp above it
 *  (markdownChipBaselineShift). It is a
 *  transform, so layout does not know about it: any ancestor that clips (the
 *  table, which needs `overflow: hidden` for its rounded corners) cuts the
 *  chip off unless it leaves this much room. A chip in a table cell was sliced
 *  across the middle (2026-09-14). Not rounded: a transform takes a fraction
 *  of a dp, and the zoomed chip uses the same value scaled. */
export const MARKDOWN_INLINE_CHIP_BASELINE_SHIFT = markdownChipBaselineShift(
  MARKDOWN_CHIP_FONT_SIZE,
  MARKDOWN_CHIP_LINE_HEIGHT
)

/** The screen's pixels per dp, which a pill's room for ink is counted in
 *  (markdownChipInkRoom); 3 where the platform does not say. */
export function markdownScreenDensity(): number {
  try {
    const density = PixelRatio.get()
    return density > 0 ? density : 3
  } catch {
    return 3
  }
}

export function makeMarkdownStyles(theme: Theme) {
  const { colors, fonts, radius, space } = theme
  const inkRoom = markdownChipInkRoom(markdownScreenDensity())
  return StyleSheet.create({
    root: {
      gap: space.sm + 2
    },
    paragraph: {
      fontFamily: fonts.regular,
      fontSize: MARKDOWN_BASE_SIZE,
      // +10, not +8: a wrapped inline code pill is an inline View whose only
      // separation from the pill on the next line is this line height (Android
      // ignores an inline View's vertical margins). See the collision invariant
      // in mobile-markdown-chip-clipping.test.ts (2026-09-14).
      lineHeight: MARKDOWN_BASE_SIZE + 10,
      color: colors.text
    },
    // Headings carry the document's structure, and at ~40 columns a reader
    // scrolls past far more of them than on a desktop. One step of size per
    // level down to h3 is what makes a section boundary visible without a
    // heading eating the screen; h4-h6 lean on weight alone.
    heading: {
      fontFamily: fonts.semibold,
      fontSize: MARKDOWN_BASE_SIZE + 1,
      lineHeight: MARKDOWN_BASE_SIZE + 9,
      color: colors.text,
      marginTop: space.xs
    },
    headingLevel1: {
      fontSize: MARKDOWN_BASE_SIZE + 7,
      lineHeight: MARKDOWN_BASE_SIZE + 15
    },
    headingLevel2: {
      fontSize: MARKDOWN_BASE_SIZE + 4,
      lineHeight: MARKDOWN_BASE_SIZE + 13
    },
    headingLevel3: {
      fontSize: MARKDOWN_BASE_SIZE + 2,
      lineHeight: MARKDOWN_BASE_SIZE + 11
    },
    bold: {
      fontFamily: fonts.semibold,
      color: colors.text
    },
    italic: {
      fontStyle: 'italic'
    },
    strike: {
      textDecorationLine: 'line-through'
    },
    link: {
      color: colors.accentText,
      textDecorationLine: 'underline'
    },
    // Inline `code`, after the Claude app: blue text in a rounded, bordered
    // chip. Android's text engine cannot round a nested Text's background
    // (it is a plain BackgroundColorSpan), so a span is a real inline View —
    // rounded and bordered — cut into one pill per line it crosses
    // (mobile-markdown-code-chip-split.ts). Only a span with a newline in it
    // stays this nested Text. Chosen by the user on 2026-09-12 over square chips.
    inlineCode: {
      fontFamily: fonts.regular,
      fontSize: MARKDOWN_CHIP_FONT_SIZE,
      color: colors.codeSpanText,
      // Translucent, so a selection's highlight shows through the chip; an
      // opaque one made every `code` span read as unselected (2026-09-12).
      backgroundColor: colors.codeSpanBg
    },
    // No margins: an inline View's margins do nothing on Android. Fabric lays
    // the View at its placeholder's origin with its border-box size
    // (ParagraphShadowNode::layout), so the space around a pill is the
    // paragraph's own space character, as around a word.
    inlineCodeChip: {
      backgroundColor: colors.codeSpanBg,
      borderWidth: MARKDOWN_CHIP_BORDER_WIDTH,
      borderColor: colors.codeSpanBorder,
      borderRadius: MARKDOWN_CHIP_RADIUS,
      paddingHorizontal: MARKDOWN_CHIP_PADDING_HORIZONTAL,
      paddingVertical: MARKDOWN_CHIP_PADDING_VERTICAL,
      // Android hangs an inline View's bottom on the baseline, which left the
      // pill's text riding above the words beside it (2026-09-12, "peak" sat
      // above its sentence; 2026-09-26, beside the Claude app's). This moves
      // the pill's text down to half a dp above the paragraph's baseline
      // (MARKDOWN_CHIP_LIFT).
      transform: [{ translateY: MARKDOWN_INLINE_CHIP_BASELINE_SHIFT }]
    },
    // The paragraph's own face, one step smaller, as the Claude app sets it
    // (2026-09-26); JetBrains Mono read wider and heavier than the words
    // around it. The line is the glyphs' own height and no more
    // (mobile-markdown-prose-scale.ts).
    inlineCodeChipText: {
      fontFamily: fonts.regular,
      fontSize: MARKDOWN_CHIP_FONT_SIZE,
      lineHeight: MARKDOWN_CHIP_LINE_HEIGHT,
      // Room for the font's ink past its line (accents, a comma below), which
      // the Text would clip, taken back in margin (markdownChipInkRoom).
      paddingTop: inkRoom.top,
      paddingBottom: inkRoom.bottom,
      marginTop: -inkRoom.top,
      marginBottom: -inkRoom.bottom,
      color: colors.codeSpanText
    },
    /** A pill in a table cell: the cell's own size, which is smaller type. */
    inlineCodeChipTextTable: {
      fontFamily: fonts.regular,
      fontSize: MARKDOWN_TABLE_CHIP_FONT_SIZE,
      lineHeight: MARKDOWN_TABLE_CHIP_LINE_HEIGHT
    },
    inlineCodeLink: {
      color: colors.accentText,
      textDecorationLine: 'underline'
    },
    /** A quote: one bar down its whole height and the text indented beside
     *  it, as the Claude app draws it (2026-09-24). A span-per-line bar broke
     *  on every wrap; see mobile-markdown-prose-runs.ts. */
    quoteBlock: {
      borderLeftWidth: 3,
      borderLeftColor: colors.borderStrong,
      paddingLeft: space.md
    },
    quoteText: {
      fontFamily: fonts.regular,
      fontSize: MARKDOWN_BASE_SIZE,
      lineHeight: MARKDOWN_BASE_SIZE + 10,
      color: colors.text
    },
    codeBlock: {
      backgroundColor: colors.codeBg,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: space.md
    },
    codeLanguage: {
      fontFamily: fonts.medium,
      fontSize: 10,
      color: colors.textMuted,
      marginBottom: space.xs,
      textTransform: 'uppercase',
      letterSpacing: 0.6
    },
    codeText: {
      fontFamily: fonts.mono,
      fontSize: MARKDOWN_BASE_SIZE - 2,
      lineHeight: MARKDOWN_BASE_SIZE + 5,
      color: colors.text
    },
    /** The line number beside a fence: dim, so the gutter reads as chrome and
     *  the eye stays on the code. Same weight the file reader's gutter uses. */
    codeGutter: {
      fontFamily: fonts.mono,
      fontSize: MARKDOWN_BASE_SIZE - 2,
      lineHeight: MARKDOWN_BASE_SIZE + 5,
      color: colors.textMuted
    },
    codeTruncated: {
      fontFamily: fonts.regular,
      fontSize: 11,
      color: colors.textMuted,
      marginTop: space.xs
    },
    /** A drawn figure, a block of its own between prose runs; see
     *  MobileMarkdown for why it is not inside the run. */
    figure: {
      width: '100%',
      marginVertical: space.sm
    },
    /** The image link's path, as a span inside the prose run (the link is
     *  what an image is until the host hands the file over, or for good when
     *  it will not; see MobileMarkdownImage). */
    imageCaptionInline: {
      fontFamily: fonts.regular,
      fontSize: 11,
      color: colors.textSecondary
    },
    /** A `---` inside the prose run; the same colour the View rule used. */
    ruleText: {
      color: colors.border
    },
    table: {
      borderTopWidth: 1,
      borderLeftWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      overflow: 'hidden',
      backgroundColor: colors.bgPanel
    },
    tableRow: {
      flexDirection: 'row'
    },
    tableCell: {
      // Width comes from the table's shared column widths (MobileMarkdown.tsx);
      // a cell must never size itself or the columns stagger row by row.
      borderRightWidth: 1,
      borderBottomWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: space.sm,
      paddingTop: space.xs,
      // 2 dp more below than above, as since 2026-09-14, when it was room for
      // the chip's shift under the table's clip. A pill now hangs inside its
      // line, at every zoom: the cell's text follows the zoom as its pills do
      // (markdownZoomedLine).
      paddingBottom: MARKDOWN_TABLE_CELL_PADDING_BOTTOM,
      fontFamily: fonts.regular,
      fontSize: MARKDOWN_TABLE_CELL_FONT_SIZE,
      // +10, the same headroom the paragraph carries, and for the same reason:
      // a cell is a block an inline code pill can wrap inside, and Android
      // ignores an inline View's vertical margins, so this line height is the
      // only separation there is. At +4 a Branch column that stacked two pills
      // of one split path collided and clipped them (device screenshot,
      // 2026-09-15). Pinned in mobile-markdown-chip-clipping.test.ts.
      lineHeight: MARKDOWN_TABLE_CELL_LINE_HEIGHT,
      color: colors.text
    },
    tableHeader: {
      fontFamily: fonts.semibold,
      backgroundColor: colors.bgRaised
    },
    tableTruncated: {
      padding: space.sm,
      fontFamily: fonts.regular,
      fontSize: MARKDOWN_BASE_SIZE - 2,
      color: colors.textMuted
    },
    /** A list marker inside the prose run. The list was a column of row
     *  Views with a marker cell and a text cell; see MobileMarkdown for why it
     *  is spans now (2026-09-19). */
    listMarkerInline: {
      fontFamily: fonts.mono,
      fontSize: MARKDOWN_BASE_SIZE - 1,
      color: colors.textSecondary
    },
    /** Kept for the chip-clipping fixture, which measures a list line. */
    listText: {
      flex: 1,
      minWidth: 0,
      fontFamily: fonts.regular,
      fontSize: MARKDOWN_BASE_SIZE,
      lineHeight: MARKDOWN_BASE_SIZE + 10,
      color: colors.text
    },
    /** The notice row's divider (MobileNativeChatNoticeRow); the markdown
     *  document draws its own `---` as `ruleText` inside the prose run. */
    rule: {
      height: 1,
      backgroundColor: colors.border
    }
  })
}

export type MarkdownStyles = ReturnType<typeof makeMarkdownStyles>

export function useMarkdownStyles(): MarkdownStyles {
  const theme = useTheme()
  return useMemo(() => makeMarkdownStyles(theme), [theme])
}
