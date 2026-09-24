import { Platform, StyleSheet } from 'react-native'
import { spacing } from '../theme/mobile-theme'

/** Structural layout only — colour comes from `useTheme()` at render time
 *  (light/dark are both required states; a literal here would freeze one). */
export const draggableDetailSheetStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill
  },
  root: {
    flex: 1
  },
  backdrop: {
    ...StyleSheet.absoluteFill
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
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    width: '100%',
    overflow: 'hidden',
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
  handleHitArea: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.4
  },
  closeButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    padding: spacing.xs,
    zIndex: 1
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg
  },
  staticContent: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg
  },
  bottomExtension: {
    position: 'absolute',
    bottom: -500,
    left: 0,
    right: 0,
    height: 500
  }
})
