// Styles for the inline diff card (Orca #18765, 172aa1ac3). Every colour comes
// from the theme, so the card is correct in light and in dark; a literal here
// would look right on one scheme and wrong on the other forever.

import { useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { useTheme, type Theme } from '../theme/theme-context'
import { MONO_SIZE } from './mobile-native-chat-message-styles'

export function makeDiffCardStyles(theme: Theme) {
  const { colors, fonts, radius, space } = theme
  return StyleSheet.create({
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      overflow: 'hidden'
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs + 2,
      backgroundColor: colors.bgRaised,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs
    },
    verb: {
      color: colors.textMuted,
      fontFamily: fonts.medium,
      fontSize: MONO_SIZE
    },
    oldPath: {
      color: colors.textMuted,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE,
      textDecorationLine: 'line-through'
    },
    arrow: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: MONO_SIZE
    },
    path: {
      flexShrink: 1,
      color: colors.text,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE
    },
    added: {
      color: colors.diffAddText,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE
    },
    removed: {
      color: colors.diffDelText,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE
    },
    truncated: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: MONO_SIZE
    },
    body: {
      backgroundColor: colors.codeBg
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start'
    },
    rowAdd: {
      backgroundColor: colors.diffAddBg
    },
    rowDel: {
      backgroundColor: colors.diffDelBg
    },
    gutter: {
      color: colors.textMuted,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE,
      lineHeight: MONO_SIZE + 5,
      textAlign: 'right',
      paddingHorizontal: space.xs
    },
    marker: {
      width: 12,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE,
      lineHeight: MONO_SIZE + 5,
      textAlign: 'center',
      color: colors.textMuted
    },
    markerAdd: {
      color: colors.diffAddText
    },
    markerDel: {
      color: colors.diffDelText
    },
    text: {
      flex: 1,
      color: colors.textSecondary,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE,
      lineHeight: MONO_SIZE + 5,
      paddingRight: space.sm
    },
    // The break between two regions of the file. Quiet enough not to read as a
    // row of content, present enough that the gutter's jump is accounted for.
    gap: {
      backgroundColor: colors.bgRaised,
      color: colors.textMuted,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE,
      lineHeight: MONO_SIZE + 5,
      textAlign: 'center'
    }
  })
}

export type DiffCardStyles = ReturnType<typeof makeDiffCardStyles>

export function useDiffCardStyles(): DiffCardStyles {
  const theme = useTheme()
  return useMemo(() => makeDiffCardStyles(theme), [theme])
}
