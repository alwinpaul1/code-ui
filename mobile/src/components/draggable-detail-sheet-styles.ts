import { Platform, StyleSheet } from 'react-native'
import { spacing } from '../theme/mobile-theme'
import { SHEET_SPEC } from './sheet-spec'

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
    borderTopLeftRadius: SHEET_SPEC.radius,
    borderTopRightRadius: SHEET_SPEC.radius,
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
    paddingHorizontal: SHEET_SPEC.handle.paddingHorizontal,
    paddingVertical: SHEET_SPEC.handle.paddingVertical
  },
  handle: {
    width: SHEET_SPEC.handle.width,
    height: SHEET_SPEC.handle.height,
    borderRadius: SHEET_SPEC.handle.borderRadius
  },
  // Left, as the Claude app's tool sheet has it (2026-09-26 screenshots).
  // 12 in from the edges, not 8: the 44 dp corner (SHEET_SPEC.radius) clips
  // what sits nearer the corner than that.
  closeButton: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
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
