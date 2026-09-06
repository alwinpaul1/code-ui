import { useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { useTheme, type Theme } from '../theme/theme-context'

export function makeChatViewStyles(theme: Theme) {
  const { colors, radius, space } = theme
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg
    },
    chromeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 30,
      paddingHorizontal: space.md
    },
    chromeLeft: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm
    },
    stopButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      paddingHorizontal: space.sm,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.dangerSoft
    },
    sendError: {
      alignItems: 'center',
      paddingHorizontal: space.md,
      paddingBottom: space.xs
    },
    chromeToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 4,
      paddingHorizontal: space.xs
    },
    pressed: {
      opacity: 0.6
    },
    listWrap: {
      flex: 1,
      position: 'relative'
    },
    listContent: {
      paddingVertical: space.sm,
      flexGrow: 1
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: space.xl,
      gap: space.sm
    },
    fab: {
      position: 'absolute',
      right: space.md,
      bottom: space.md,
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bgPanel,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: colors.shadow,
      shadowOpacity: 1,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4
    },
    loadEarlier: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: space.md,
      minHeight: 36
    }
  })
}

export type ChatViewStyles = ReturnType<typeof makeChatViewStyles>

export function useChatViewStyles(): ChatViewStyles {
  const theme = useTheme()
  return useMemo(() => makeChatViewStyles(theme), [theme])
}
