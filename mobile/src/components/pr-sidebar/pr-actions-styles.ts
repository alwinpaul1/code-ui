import { StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../../theme/mobile-theme'
import type { Theme } from '../../theme/theme-context'

// The merge CTA's fill + on-fill text, mirroring the desktop ChecksPanel's
// affirmative "Squash and merge" button (bg-green-600 / white). A local named
// constant rather than a theme token per the brief: this is one button's brand
// colour, the same green in both schemes, not a surface that should shift with
// the appearance setting.
export const MERGE_GREEN = '#16a34a'
export const ON_MERGE_GREEN = '#ffffff'

// Styles for PRActionsSection (action buttons, auto-merge toggle, transient-error
// line). Split out of mobile-pr-sidebar-styles to keep that file under the
// 300-line cap. Built from the live theme so the sidebar reads in both schemes.
export function prActionsStyles({ colors }: Theme) {
  return StyleSheet.create({
    // Bare block when identity + actions share one section card.
    actionsBlock: {
      gap: spacing.sm
    },
    // Close/Reopen + Unlink share a row so secondary actions don't stack full-width.
    secondaryRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: spacing.sm
    },
    secondaryButton: {
      flex: 1
    },
    // Primary CTA (merge) and secondary action buttons (close/reopen/rerun/add).
    actionButton: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border
    },
    // Neutral primary: a light fill with dark text, mirroring the desktop PR page's
    // default button (no bright accent) so the sidebar stays mostly monochrome. The
    // fill/text pair is the same "inverse surface" the app uses for its one bright
    // action elsewhere: near-black-on-cream in light, near-white-on-ink in dark.
    actionButtonPrimary: {
      backgroundColor: colors.text,
      borderColor: colors.text
    },
    // Merge CTA: green fill + white text, matching the desktop ChecksPanel's
    // affirmative merge action. The merge still confirms before firing.
    actionButtonMerge: {
      backgroundColor: MERGE_GREEN,
      borderColor: MERGE_GREEN
    },
    actionButtonTextMerge: {
      color: ON_MERGE_GREEN
    },
    actionButtonDisabled: {
      opacity: 0.5
    },
    actionButtonText: {
      // Why: shrink + single-line (numberOfLines=1 at call sites) so a long label
      // like "Link existing pull request" can't wrap and inflate the button's
      // effective padding on a narrow sidebar.
      flexShrink: 1,
      color: colors.text,
      fontSize: typography.bodySize,
      fontWeight: '700'
    },
    actionButtonTextPrimary: {
      color: colors.bg
    },
    actionButtonDestructiveText: {
      color: colors.danger
    },
    // Auto-merge toggle row: label + a pill that reflects on/off state.
    toggleRow: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm
    },
    toggleLabel: {
      color: colors.text,
      fontSize: typography.bodySize,
      flexShrink: 1
    },
    togglePill: {
      minWidth: 56,
      minHeight: 30,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.sm,
      borderRadius: radii.button,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.bgPanel
    },
    togglePillOn: {
      borderColor: colors.textSecondary,
      backgroundColor: colors.bgRaised
    },
    togglePillText: {
      fontSize: typography.metaSize,
      fontWeight: '700',
      color: colors.textSecondary
    },
    togglePillTextOn: {
      color: colors.text
    },
    // Non-blocking error line shown under an action after a transient failure.
    actionError: {
      color: colors.danger,
      fontSize: typography.metaSize,
      lineHeight: 18
    }
  })
}
