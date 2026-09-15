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

/** One level of list nesting, in px. Narrow on purpose: at ~40 columns a
 *  desktop-sized indent leaves a third-level item too little room to read. */
export const MARKDOWN_LIST_INDENT = 16

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
    quote: {
      borderLeftWidth: 2,
      borderLeftColor: colors.borderStrong,
      paddingLeft: space.md
    },
    quoteText: {
      fontFamily: fonts.regular,
      fontSize: MARKDOWN_BASE_SIZE,
      lineHeight: MARKDOWN_BASE_SIZE + 10,
      color: colors.textSecondary
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
    imageFrame: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.bgRaised,
      overflow: 'hidden',
      padding: space.sm
    },
    imageCaption: {
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      fontFamily: fonts.regular,
      fontSize: 11,
      color: colors.textSecondary
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
      lineHeight: MARKDOWN_BASE_SIZE + 4,
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
    list: {
      gap: space.xs + 2
    },
    listItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: space.sm
    },
    listMarker: {
      // minWidth, not width: a fixed 22 clipped `10.` and beyond. Each marker
      // then sizes to its own content, so a list that crosses 9 indents its
      // tenth item a few px further than its ninth — the readable trade against
      // a clipped number.
      minWidth: 22,
      fontFamily: fonts.mono,
      fontSize: MARKDOWN_BASE_SIZE - 1,
      lineHeight: MARKDOWN_BASE_SIZE + 10,
      color: colors.textSecondary
    },
    listText: {
      flex: 1,
      minWidth: 0,
      fontFamily: fonts.regular,
      fontSize: MARKDOWN_BASE_SIZE,
      lineHeight: MARKDOWN_BASE_SIZE + 10,
      color: colors.text
    },
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
