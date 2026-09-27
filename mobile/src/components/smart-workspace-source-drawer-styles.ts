import { StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../theme/mobile-theme'
import type { Theme } from '../theme/theme-context'
import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'

/** The smart-workspace source drawer's styles, built from the live theme so it reads in light
 *  and in dark. Only the colours come from the theme; the sizes are the legacy scale's numbers,
 *  which are the same in both schemes. Callers take it through
 *  `useThemedStyles(smartWorkspaceSourceDrawerStyles)`. */
export function smartWorkspaceSourceDrawerStyles({ colors }: Theme) {
  return StyleSheet.create({
    root: {
      flex: 1,
      minHeight: 0
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xs,
      paddingBottom: spacing.sm,
      flexShrink: 0
    },
    title: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text
    },
    done: {
      fontSize: typography.bodySize,
      fontWeight: '600',
      color: colors.accent
    },
    results: {
      flex: 1,
      minHeight: 0
    },
    list: {
      flex: 1,
      backgroundColor: colors.bgPanel,
      borderTopLeftRadius: radii.card,
      borderTopRightRadius: radii.card,
      overflow: 'hidden'
    },
    listContent: {
      flexGrow: 1,
      paddingBottom: spacing.sm
    },
    // Why: pin the dock to the sheet bottom so a flex-greedy FlatList cannot
    // push the TextInput out of the fill frame (and under the keyboard).
    dock: {
      flexShrink: 0,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.bg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      gap: spacing.sm,
      zIndex: 2
    },
    search: {
      backgroundColor: colors.bgRaised,
      color: colors.text,
      borderRadius: radii.input,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      fontSize: TEXT_INPUT_FONT_SIZE,
      borderWidth: 1,
      borderColor: colors.border
    },
    tabRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs
    },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.xs + 2,
      borderRadius: radii.button,
      borderWidth: 1,
      borderColor: colors.border
    },
    tabSelected: {
      backgroundColor: colors.bgPanel,
      borderColor: colors.textSecondary
    },
    tabText: {
      fontSize: 13,
      color: colors.textSecondary
    },
    tabTextSelected: {
      color: colors.text,
      fontWeight: '600'
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs
    },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radii.button,
      borderWidth: 1,
      borderColor: colors.border
    },
    chipSelected: {
      backgroundColor: colors.bgPanel,
      borderColor: colors.textSecondary
    },
    chipText: {
      fontSize: 12,
      color: colors.textSecondary
    },
    chipTextSelected: {
      color: colors.text,
      fontWeight: '600'
    },
    crossRepo: {
      backgroundColor: colors.bgRaised,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      marginBottom: spacing.sm,
      gap: spacing.sm
    },
    crossRepoText: {
      fontSize: 13,
      color: colors.textSecondary
    },
    crossRepoActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.sm
    },
    crossRepoDismiss: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: radii.button,
      borderWidth: 1,
      borderColor: colors.border
    },
    crossRepoDismissText: {
      fontSize: 13,
      color: colors.textSecondary
    },
    crossRepoSwitch: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: radii.button,
      backgroundColor: colors.bgPanel,
      borderWidth: 1,
      borderColor: colors.textSecondary
    },
    crossRepoSwitchText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text
    },
    notice: {
      fontSize: 12,
      color: colors.textMuted,
      paddingHorizontal: spacing.xs,
      paddingBottom: spacing.sm
    },
    errorNotice: {
      fontSize: 12,
      color: colors.danger,
      paddingHorizontal: spacing.xs,
      paddingBottom: spacing.sm
    },
    loading: {
      paddingVertical: spacing.lg,
      alignItems: 'center'
    },
    empty: {
      paddingVertical: spacing.lg,
      textAlign: 'center',
      color: colors.textMuted,
      fontSize: 13
    }
  })
}
