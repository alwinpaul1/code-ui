import { StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../../theme/mobile-theme'
import type { Theme } from '../../theme/theme-context'

// Styles for the conflicting-files section (file list + fallback notice). Muted/
// monochrome to match the rest of the PR sidebar; split out so the section file and
// the shared sidebar styles each stay focused. Ports the LOOK of the desktop
// ConflictingFilesSection / MergeConflictNotice. Built from the live theme so it
// reads in both schemes.
export function prConflictStyles({ colors }: Theme) {
  return StyleSheet.create({
    meta: {
      color: colors.textSecondary,
      fontSize: 11
    },
    metaMono: {
      fontFamily: typography.monoFamily,
      color: colors.textSecondary,
      fontSize: 11
    },
    filesHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.sm
    },
    filesHeaderText: {
      color: colors.textSecondary,
      fontSize: 11
    },
    // The file list is capped + scrollable so a long conflict set doesn't push the
    // rest of the sidebar off-screen (it lives inside the outer ScrollView).
    fileList: {
      maxHeight: 180,
      marginTop: spacing.sm
    },
    fileListContent: {
      gap: spacing.xs
    },
    fileRow: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.bgRaised,
      borderRadius: radii.button,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs
    },
    filePath: {
      color: colors.text,
      fontSize: 11,
      fontFamily: typography.monoFamily
    },
    noticeTitle: {
      color: colors.text,
      fontSize: 11,
      fontWeight: '600'
    },
    noticeBody: {
      color: colors.textSecondary,
      fontSize: 11,
      marginTop: spacing.xs
    },
    commandBox: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.bgRaised,
      borderRadius: radii.button,
      marginTop: spacing.sm,
      padding: spacing.sm
    },
    commandHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm
    },
    commandLabel: {
      color: colors.textSecondary,
      fontSize: 10,
      fontWeight: '600'
    },
    copyCommandButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radii.button,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs
    },
    copyCommandButtonPressed: {
      backgroundColor: colors.border
    },
    copyCommandText: {
      color: colors.text,
      fontSize: 11,
      fontWeight: '600'
    },
    commandText: {
      color: colors.text,
      fontFamily: typography.monoFamily,
      fontSize: 10,
      lineHeight: 15,
      marginTop: spacing.sm
    }
  })
}
