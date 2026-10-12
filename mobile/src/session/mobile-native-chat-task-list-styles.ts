// Styles for the inline task checklist (Orca #19230, d15a6df22). Every colour
// comes from the theme, so the checklist is correct in light and in dark; a
// literal here would look right on one scheme and wrong on the other forever.
// The three step states are told apart by colour AND by glyph, so the one that
// is running is still findable when the two tones are close.

import { useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { useTheme, type Theme } from '../theme/theme-context'
import { MONO_SIZE } from './mobile-native-chat-message-styles'

export function makeTaskListStyles(theme: Theme) {
  const { colors, fonts, space } = theme
  return StyleSheet.create({
    list: {
      gap: space.xs,
      paddingVertical: space.xs
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs + 2
    },
    title: {
      color: colors.textMuted,
      fontFamily: fonts.medium,
      fontSize: MONO_SIZE
    },
    progress: {
      color: colors.textMuted,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: space.xs + 2
    },
    icon: {
      paddingTop: 2
    },
    // Pending is the quiet default; a finished step takes the success tone and
    // a running one takes full foreground, because it is the line to read.
    task: {
      flex: 1,
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: MONO_SIZE,
      lineHeight: MONO_SIZE + 5
    },
    taskDone: {
      color: colors.success
    },
    taskActive: {
      color: colors.text,
      fontFamily: fonts.medium
    },
    explanation: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: MONO_SIZE,
      lineHeight: MONO_SIZE + 5
    },
    disclosure: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs
    },
    disclosureLabel: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: MONO_SIZE
    }
  })
}

export type TaskListStyles = ReturnType<typeof makeTaskListStyles>

export function useTaskListStyles(): TaskListStyles {
  const theme = useTheme()
  return useMemo(() => makeTaskListStyles(theme), [theme])
}
