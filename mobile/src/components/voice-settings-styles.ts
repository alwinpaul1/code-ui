import { StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../theme/mobile-theme'
import type { Theme } from '../theme/theme-context'

// The Voice settings screen’s StyleSheet, moved out of app/voice-settings.tsx
// verbatim when that route crossed the 400-line cap (0.6.7). Built from the live
// theme (`useThemedStyles(voiceSettingsStyles)`) so it reads in light and dark.
export function voiceSettingsStyles({ colors }: Theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
      paddingHorizontal: spacing.lg
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: spacing.sm,
      marginBottom: spacing.lg
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.sm
    },
    heading: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.text
    },
    scrollContent: {
      paddingBottom: spacing.xl
    },
    loading: { paddingVertical: spacing.xl, alignItems: 'center' },
    groupHeading: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textMuted,
      letterSpacing: 0.5,
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.xs
    },
    section: {
      backgroundColor: colors.bgPanel,
      borderRadius: radii.card,
      overflow: 'hidden'
    },
    sectionTopGap: { marginTop: spacing.sm },
    inputGroupGap: { marginTop: spacing.xl },
    disabled: { opacity: 0.5 },
    emptyText: {
      fontSize: typography.bodySize,
      color: colors.textSecondary,
      padding: spacing.md
    },
    errorText: {
      fontSize: typography.bodySize,
      color: colors.danger,
      padding: spacing.md
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm + 2,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md + 2
    },
    rowPressed: { backgroundColor: colors.bgRaised },
    rowContent: { flex: 1 },
    rowLabel: {
      fontSize: typography.bodySize,
      fontWeight: '500',
      color: colors.text
    },
    drawerTitle: {
      fontSize: typography.bodySize,
      fontWeight: '700',
      color: colors.text,
      paddingHorizontal: spacing.md + 2,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xs
    },
    rowSublabel: {
      fontSize: typography.bodySize - 2,
      color: colors.textSecondary,
      marginTop: 2
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginHorizontal: spacing.md
    },
    segmented: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.bg,
      borderRadius: radii.button,
      padding: 2
    },
    segment: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radii.button - 1
    },
    segmentActive: { backgroundColor: colors.bgRaised },
    segmentText: { fontSize: typography.metaSize, color: colors.textSecondary, fontWeight: '600' },
    segmentTextActive: { color: colors.text },
    error: { color: colors.danger, fontSize: typography.metaSize, marginTop: spacing.md }
  })
}
