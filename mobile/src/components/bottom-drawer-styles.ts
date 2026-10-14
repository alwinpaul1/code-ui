import { Platform, StyleSheet } from 'react-native'
import { spacing } from '../theme/mobile-theme'
import type { Theme } from '../theme/theme-context'
import { SHEET_SPEC, sheetColors } from './sheet-spec'

export function bottomDrawerStyles({ colors }: Theme) {
  // The one sheet spec (sheet-spec.ts): corners, ground, grabber and scrim.
  const sheet = sheetColors(colors)
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
      backgroundColor: sheet.scrim
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
      backgroundColor: sheet.container,
      borderTopLeftRadius: SHEET_SPEC.radius,
      borderTopRightRadius: SHEET_SPEC.radius,
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
    // Drawn only on a sheet with a partial stop; a one-rest sheet keeps the
    // same box without the fill (`sheetShowsHandle`).
    handle: {
      width: SHEET_SPEC.handle.width,
      height: SHEET_SPEC.handle.height,
      borderRadius: SHEET_SPEC.handle.borderRadius,
      backgroundColor: sheet.handle
    },
    handleSpace: {
      width: SHEET_SPEC.handle.width,
      height: SHEET_SPEC.handle.height
    },
    handleHitArea: {
      alignItems: 'center',
      paddingHorizontal: SHEET_SPEC.handle.paddingHorizontal,
      paddingVertical: SHEET_SPEC.handle.paddingVertical
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
      backgroundColor: sheet.container
    }
  })
}
