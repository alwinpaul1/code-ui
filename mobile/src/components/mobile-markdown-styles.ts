import { useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { useTheme, type Theme } from '../theme/theme-context'

/** Base prose size; the chat view passes a textScale above 1 on top of it. */
import { MARKDOWN_BASE_SIZE } from './mobile-markdown-prose-scale'
export { MARKDOWN_BASE_SIZE } from './mobile-markdown-prose-scale'

/** How far an inline code chip is painted BELOW its layout box, to sit level
 *  with the text around it. It is a transform, so layout does not know about
 *  it: any ancestor that clips (the table, which needs `overflow: hidden` for
 *  its rounded corners) cuts the chip off unless it leaves this much room.
 *  A chip in a table cell was sliced across the middle (2026-09-14). */
export const MARKDOWN_INLINE_CHIP_BASELINE_SHIFT = 2

export function makeMarkdownStyles(theme: Theme) {
  const { colors, fonts, radius, space } = theme
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
    // (it is a plain BackgroundColorSpan), so a SHORT span is a real inline
    // View — rounded and bordered — while a long one stays a nested Text so
    // it can still wrap. Chosen by the user on 2026-09-12 over square chips.
    inlineCode: {
      fontFamily: fonts.mono,
      fontSize: MARKDOWN_BASE_SIZE - 2,
      color: colors.codeSpanText,
      // Translucent, so a selection's highlight shows through the chip; an
      // opaque one made every `code` span read as unselected (2026-09-12).
      backgroundColor: colors.codeSpanBg
    },
    inlineCodeChip: {
      backgroundColor: colors.codeSpanBg,
      borderWidth: 1,
      borderColor: colors.codeSpanBorder,
      borderRadius: 7,
      paddingHorizontal: 5,
      paddingVertical: 1,
      // Two pieces of one split path can land side by side on the same line
      // ("chapters/" then "_archive…/"); at 1px their rounded borders collided
      // and read as one broken pill (2026-09-14). This keeps a clear gap.
      marginHorizontal: 3,
      // Air above and below, so a span that wraps onto a second line does not
      // touch the pill above it; the line box grows with the margin, which is
      // what keeps the text around it evenly spaced (2026-09-13).
      marginVertical: 3,
      // Android hangs an inline View from the baseline, so a chip taller than
      // the text's ascent floats above the line (2026-09-12, "peak" sat above
      // its sentence). Half the extra height brings it level.
      transform: [{ translateY: MARKDOWN_INLINE_CHIP_BASELINE_SHIFT }]
    },
    inlineCodeChipText: {
      fontFamily: fonts.mono,
      fontSize: MARKDOWN_BASE_SIZE - 2,
      // +1 (16 at base 15): tall enough for the mono font's descenders, short
      // enough that the pill's painted footprint clears the prose line height,
      // so a wrapped pill never overlaps the pill on the line below.
      lineHeight: MARKDOWN_BASE_SIZE + 1,
      color: colors.codeSpanText
    },
    inlineCodeLink: {
      color: colors.accentText,
      textDecorationLine: 'underline'
    },
    /** A quote inside the prose run: muted text behind a bar span on each
     *  line (`quoteBar`). It was a View with a left border; see MobileMarkdown
     *  for why it is a span now (2026-09-19). */
    quoteText: {
      fontFamily: fonts.regular,
      fontSize: MARKDOWN_BASE_SIZE,
      lineHeight: MARKDOWN_BASE_SIZE + 10,
      color: colors.textSecondary
    },
    quoteBar: {
      color: colors.borderStrong
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
      // The extra room below is for an inline code chip: it is painted
      // MARKDOWN_INLINE_CHIP_BASELINE_SHIFT px lower than it is laid out, and
      // the table clips, so without this the chip loses its bottom.
      paddingBottom: space.xs + MARKDOWN_INLINE_CHIP_BASELINE_SHIFT,
      fontFamily: fonts.regular,
      fontSize: MARKDOWN_BASE_SIZE - 2,
      // +10, the same headroom the paragraph carries, and for the same reason:
      // a cell is a block an inline code pill can wrap inside, and Android
      // ignores an inline View's vertical margins, so this line height is the
      // only separation there is. At +4 a Branch column that stacked two pills
      // of one split path collided and clipped them (device screenshot,
      // 2026-09-15). Pinned in mobile-markdown-chip-clipping.test.ts.
      lineHeight: MARKDOWN_BASE_SIZE + 10,
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
