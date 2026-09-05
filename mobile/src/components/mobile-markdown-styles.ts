import { useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { useTheme, type Theme } from '../theme/theme-context'

/** Base prose size; the chat view passes a textScale above 1 on top of it. */
export const MARKDOWN_BASE_SIZE = 15

export function makeMarkdownStyles(theme: Theme) {
  const { colors, fonts, radius, space } = theme
  return StyleSheet.create({
    root: {
      gap: space.sm + 2
    },
    paragraph: {
      fontFamily: fonts.regular,
      fontSize: MARKDOWN_BASE_SIZE,
      lineHeight: MARKDOWN_BASE_SIZE + 8,
      color: colors.text
    },
    heading: {
      fontFamily: fonts.semibold,
      fontSize: MARKDOWN_BASE_SIZE + 1,
      lineHeight: MARKDOWN_BASE_SIZE + 8,
      color: colors.text,
      marginTop: space.xs
    },
    headingLarge: {
      fontSize: MARKDOWN_BASE_SIZE + 3,
      lineHeight: MARKDOWN_BASE_SIZE + 10
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
    inlineCode: {
      fontFamily: fonts.mono,
      fontSize: MARKDOWN_BASE_SIZE - 2,
      color: colors.text,
      backgroundColor: colors.codeBg,
      borderRadius: radius.xs,
      paddingHorizontal: 4
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
      lineHeight: MARKDOWN_BASE_SIZE + 8,
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
      minWidth: 112,
      maxWidth: 220,
      borderRightWidth: 1,
      borderBottomWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
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
      width: 22,
      fontFamily: fonts.mono,
      fontSize: MARKDOWN_BASE_SIZE - 1,
      lineHeight: MARKDOWN_BASE_SIZE + 8,
      color: colors.textSecondary
    },
    listText: {
      flex: 1,
      minWidth: 0,
      fontFamily: fonts.regular,
      fontSize: MARKDOWN_BASE_SIZE,
      lineHeight: MARKDOWN_BASE_SIZE + 8,
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
