import { Platform, StyleSheet } from 'react-native'
import { spacing } from '../theme/mobile-theme'
import type { Theme } from '../theme/theme-context'

export function bottomDrawerStyles({ colors }: Theme) {
  return StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFill,
      zIndex: 1000
    },
    root: {
      flex: 1
    },
    backdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: colors.bgOverlay
    },
    backdropPressable: {
      ...StyleSheet.absoluteFill
    },
    anchor: {
      flex: 1,
      justifyContent: 'flex-end'
    },
    anchorWide: {
      alignItems: 'center'
    },
    drawer: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: spacing.md,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.2,
          shadowRadius: 10
        },
        android: { elevation: 8 }
      })
    },
    drawerFill: {
      // Why: flex children (results + dock) need a column height budget; without
      // this, fill height alone still leaves staticContent height content-sized.
      overflow: 'hidden',
      flexDirection: 'column'
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.textMuted,
      opacity: 0.4
    },
    handleHitArea: {
      alignItems: 'center',
      paddingTop: spacing.sm,
      paddingBottom: spacing.md
    },
    staticContent: {
      minHeight: 0
    },
    staticContentFill: {
      flex: 1
    },
    bottomStrip: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0
    },
    bottomExtension: {
      position: 'absolute',
      bottom: -500,
      left: 0,
      right: 0,
      height: 500,
      backgroundColor: colors.bg
    }
  })
}
