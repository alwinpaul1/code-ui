import { StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../theme/mobile-theme'
import type { Theme } from '../theme/theme-context'

/**
 * The history screen's styles, built from the live theme so the panel reads in light and in dark.
 *
 * Only the colours come from the theme. The sizes are still the legacy scale's numbers, which are
 * the same in both schemes, so moving the panel off the dark-only palette moved nothing on screen
 * but colour. Callers take it through `useThemedStyles(agentHistoryStyles)`.
 */
export function agentHistoryStyles({ colors }: Theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg
    },
    header: {
      backgroundColor: colors.bg
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border
    },
    backButton: {
      padding: spacing.xs,
      borderRadius: radii.button
    },
    backButtonPressed: {
      backgroundColor: colors.bgRaised
    },
    titleBlock: {
      flex: 1,
      marginHorizontal: spacing.sm
    },
    title: {
      color: colors.text,
      fontSize: typography.titleSize,
      fontWeight: '600'
    },
    meta: {
      color: colors.textSecondary,
      fontSize: typography.metaSize
    },
    refreshButton: {
      padding: spacing.xs,
      borderRadius: radii.button
    },
    refreshButtonPressed: {
      backgroundColor: colors.bgRaised
    },
    scopeTabs: {
      flexDirection: 'row',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      gap: spacing.xs
    },
    scopeTab: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderRadius: radii.button,
      backgroundColor: colors.bgPanel
    },
    scopeTabActive: {
      backgroundColor: colors.bgRaised
    },
    scopeTabText: {
      color: colors.textSecondary,
      fontSize: typography.bodySize
    },
    scopeTabTextActive: {
      color: colors.text,
      fontWeight: '600'
    },
    searchRow: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm
    },
    searchInput: {
      backgroundColor: colors.bgPanel,
      borderRadius: radii.input,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: colors.text,
      fontSize: typography.bodySize
    },
    list: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xl
    },
    groupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      gap: spacing.sm
    },
    groupHeaderText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      fontWeight: '600',
      textTransform: 'uppercase'
    },
    groupHeaderCount: {
      color: colors.textMuted,
      fontSize: typography.metaSize
    },
    card: {
      backgroundColor: colors.bgPanel,
      borderRadius: radii.card,
      padding: spacing.md,
      marginBottom: spacing.sm
    },
    cardPressed: {
      backgroundColor: colors.bgRaised
    },
    cardTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm
    },
    cardTitle: {
      flex: 1,
      color: colors.text,
      fontSize: typography.bodySize,
      fontWeight: '600'
    },
    cardTimeAgo: {
      color: colors.textMuted,
      fontSize: typography.metaSize
    },
    cardLastMessage: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      marginTop: spacing.xs
    },
    cardMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.xs
    },
    cardMetaText: {
      color: colors.textMuted,
      fontSize: typography.metaSize
    },
    currentBadge: {
      backgroundColor: colors.bgRaised,
      borderRadius: radii.button,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2
    },
    currentBadgeText: {
      color: colors.accentText,
      fontSize: typography.metaSize,
      fontWeight: '600'
    },
    resumeButton: {
      minHeight: 28,
      minWidth: 28,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 'auto',
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.xs,
      borderRadius: radii.button
    },
    resumeButtonPressed: {
      opacity: 0.78
    },
    resumeButtonDisabled: {
      opacity: 0.45
    },
    preview: {
      marginTop: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      gap: spacing.sm
    },
    previewTurn: {
      gap: 2
    },
    previewRole: {
      color: colors.textMuted,
      fontSize: typography.metaSize,
      fontWeight: '600',
      textTransform: 'uppercase'
    },
    previewText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize
    },
    noticeBanner: {
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      padding: spacing.sm,
      borderRadius: radii.input,
      backgroundColor: colors.bgPanel
    },
    noticeText: {
      color: colors.warning,
      fontSize: typography.metaSize
    },
    resumeBanner: {
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      padding: spacing.sm,
      borderRadius: radii.input,
      backgroundColor: colors.bgPanel
    },
    resumeBannerText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize
    },
    state: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
      gap: spacing.sm
    },
    stateTitle: {
      color: colors.text,
      fontSize: typography.bodySize,
      fontWeight: '600'
    },
    stateText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      textAlign: 'center'
    },
    retryButton: {
      marginTop: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised
    },
    retryText: {
      color: colors.text,
      fontSize: typography.bodySize,
      fontWeight: '600'
    }
  })
}
