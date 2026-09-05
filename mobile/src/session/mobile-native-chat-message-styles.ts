import { useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { useTheme, type Theme } from '../theme/theme-context'

/** User bubble text size; agent prose is set by MobileMarkdown. */
export const TEXT_SIZE = 15
export const MONO_SIZE = 12

export function makeChatMessageStyles(theme: Theme) {
  const { colors, fonts, radius, space } = theme
  return StyleSheet.create({
    row: {
      paddingHorizontal: space.lg,
      paddingVertical: space.sm
    },
    rowUser: {
      alignItems: 'flex-end'
    },
    content: {
      maxWidth: '100%',
      gap: space.sm
    },
    userBubble: {
      maxWidth: '86%',
      backgroundColor: colors.userBubble,
      borderRadius: radius.lg,
      borderBottomRightRadius: radius.xs,
      paddingHorizontal: space.md + 2,
      paddingVertical: space.sm + 2
    },
    userText: {
      fontFamily: fonts.regular,
      color: colors.userBubbleText,
      fontSize: TEXT_SIZE,
      lineHeight: TEXT_SIZE + 7
    },
    controls: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: space.xs,
      marginBottom: 2,
      opacity: 0.8
    },
    controlButton: {
      padding: 4
    },
    controlPressed: {
      opacity: 0.5
    },
    copied: {
      backgroundColor: colors.successSoft,
      borderRadius: radius.md
    },
    // Reasoning ("Thinking") disclosure, #17579.
    reasoning: {
      borderLeftWidth: 2,
      borderLeftColor: colors.border,
      paddingLeft: space.md
    },
    reasoningHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs + 2,
      paddingVertical: 2
    },
    reasoningBody: {
      marginTop: space.xs,
      opacity: 0.85
    },
    toolRun: {
      marginTop: space.xs
    },
    toolRunHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm
    },
    toolRunToggle: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingVertical: 4
    },
    controlsRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end'
    },
    toolRunCount: {
      color: colors.success,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE,
      fontWeight: '700'
    },
    toolRunLabel: {
      flex: 1,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
      fontSize: 13
    },
    toolRunBody: {
      paddingLeft: space.sm + 2,
      borderLeftWidth: 2,
      borderLeftColor: colors.border,
      marginTop: space.xs,
      gap: 2
    },
    toolLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingVertical: 4
    },
    toolName: {
      color: colors.text,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE + 1
    },
    toolPreview: {
      flex: 1,
      color: colors.textMuted,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE
    },
    toolPreviewLink: {
      color: colors.accentText,
      textDecorationLine: 'underline'
    },
    toolDetail: {
      paddingLeft: space.lg + 4,
      paddingBottom: space.xs,
      gap: space.xs
    },
    mono: {
      color: colors.textSecondary,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE,
      lineHeight: MONO_SIZE + 5
    },
    toolResult: {
      borderRadius: radius.sm,
      backgroundColor: colors.codeBg,
      padding: space.md
    },
    toolResultError: {
      backgroundColor: colors.dangerSoft
    },
    imageRef: {
      color: colors.textSecondary,
      fontFamily: fonts.regular,
      fontSize: TEXT_SIZE
    },
    imageThumb: {
      width: 200,
      height: 150,
      borderRadius: radius.md,
      backgroundColor: colors.bgRaised,
      borderWidth: 1,
      borderColor: colors.border
    },
    diff: {
      borderRadius: radius.sm,
      backgroundColor: colors.codeBg,
      paddingVertical: space.xs,
      overflow: 'hidden'
    },
    diffLine: {
      color: colors.textSecondary,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE,
      lineHeight: MONO_SIZE + 5,
      paddingHorizontal: space.sm
    },
    diffAdd: {
      color: colors.diffAddText,
      backgroundColor: colors.diffAddBg
    },
    diffDel: {
      color: colors.diffDelText,
      backgroundColor: colors.diffDelBg
    },
    diffMeta: {
      color: colors.textMuted
    }
  })
}

export type ChatMessageStyles = ReturnType<typeof makeChatMessageStyles>

export function useChatMessageStyles(): ChatMessageStyles {
  const theme = useTheme()
  return useMemo(() => makeChatMessageStyles(theme), [theme])
}
