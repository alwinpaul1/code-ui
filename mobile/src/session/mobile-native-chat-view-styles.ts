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
    // A bare line here was painted over the transcript, since the dock has no ground (2026-10-02), so the pill
    // keeps its own opaque panel surface so it reads as a notice:
    // dangerSoft is translucent, and danger text on bgRaised is under 4.5:1.
    sendErrorPill: {
      maxWidth: '100%',
      paddingHorizontal: space.md,
      paddingVertical: space.xs + 2,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgPanel
    },
    pressed: {
      opacity: 0.6
    },
    listWrap: {
      flex: 1,
      position: 'relative'
    },
    // The composer and its chrome float over the list, absolutely placed, with
    // nothing behind them (see below).
    dock: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0
      // No ground, here or as a child: the transcript shows through the row and
      // the glass composer. A page-coloured ground with a fade above the row
      // (2026-10-09) was withdrawn the next day at the user's request ("used to
      // be transparent", and the composer "transparent too like glass"). A flat ground read as
      // a line above the Working row each time it was tried: the translucent
      // one on 2026-09-13 (removed the same day, 0a8642a6), the page-coloured
      // opaque one on 2026-09-19 (a hard edge over scrolled rows), and the
      // translucent one again on 2026-09-20 ("a black line above the tools").
      // The list keeps a spacer at its end as tall as the dock, so at rest no
      // message sits under it.
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
