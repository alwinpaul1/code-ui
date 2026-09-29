import { StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../theme/mobile-theme'
import type { Theme } from '../theme/theme-context'

export const terminalShortcutSettingsStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    groupHeading: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textMuted,
      letterSpacing: 0.5,
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.xs
    },
    groupTopGap: {
      marginTop: spacing.xl
    },
    section: {
      backgroundColor: colors.bgPanel,
      borderRadius: radii.card,
      overflow: 'hidden'
    },
    sectionTopGap: {
      marginTop: spacing.sm
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm + 2,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md + 2
    },
    rowPressed: {
      backgroundColor: colors.bgRaised
    },
    // Why: rows inside DragReorderList get a fixed height and a trailing grip
    // handle from the list itself, so content only pads on the left.
    reorderRowContent: {
      flex: 1,
      height: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm + 2,
      paddingLeft: spacing.md + 2
    },
    rowContent: {
      flex: 1
    },
    rowLabel: {
      fontSize: typography.bodySize,
      fontWeight: '500',
      color: colors.text
    },
    rowSublabel: {
      fontSize: typography.bodySize - 2,
      color: colors.textSecondary,
      marginTop: 2
    },
    keycap: {
      minWidth: 62,
      alignItems: 'center',
      backgroundColor: colors.bgRaised,
      borderRadius: radii.button,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs
    },
    keycapText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      fontFamily: typography.monoFamily
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginHorizontal: spacing.md
    },
    emptyContainer: {
      padding: spacing.md,
      alignItems: 'center',
      justifyContent: 'center'
    },
    emptyText: {
      fontSize: typography.bodySize,
      color: colors.textSecondary,
      padding: spacing.md
    },
    // Was a flat Tailwind red-500 rgba, always the same in both schemes. Derived from the theme's own
    // `danger` colour instead, so the delete affordance stays correctly red in both light and dark;
    // no token gives a stronger tint for the pressed state, so it's the same colour at higher alpha.
    deleteButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.danger, 0.14)
    },
    deleteButtonPressed: {
      backgroundColor: withAlpha(colors.danger, 0.24)
    }
  })

/** Adds an alpha channel to a `#rrggbb` theme colour. Local to this file: tokens.ts stays untouched. */
const withAlpha = (hex: string, alpha: number): string =>
  `rgba(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(', ')}, ${alpha})`
