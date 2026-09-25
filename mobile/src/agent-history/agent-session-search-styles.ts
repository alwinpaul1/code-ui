import { StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../theme/mobile-theme'
import type { Theme } from '../theme/theme-context'

/**
 * The search panel's own styles, from the live theme like the rest of the history screen
 * (agent-history-styles.ts). The hit cards reuse that file's card styles; these are the pieces
 * only search has: the sort row, the index notice, the highlighted match, the paging footer.
 *
 * A match is marked with the accent's soft wash and the body text colour, never a fixed colour,
 * so it reads on both canvases: accentSoft is a pale clay on light and a deep one on dark.
 */
export function agentSessionSearchStyles({ colors }: Theme) {
  return StyleSheet.create({
    body: {
      flex: 1
    },
    sortRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm
    },
    sortCount: {
      flex: 1,
      color: colors.textMuted,
      fontSize: typography.metaSize
    },
    sortOption: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radii.button,
      backgroundColor: colors.bgPanel
    },
    sortOptionActive: {
      backgroundColor: colors.bgRaised
    },
    sortOptionText: {
      color: colors.textSecondary,
      fontSize: typography.metaSize
    },
    sortOptionTextActive: {
      color: colors.text,
      fontWeight: '600'
    },
    notice: {
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
      padding: spacing.md,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgPanel,
      gap: spacing.xs
    },
    noticeWarning: {
      backgroundColor: colors.warningSoft,
      borderColor: colors.warningSoft
    },
    noticeDanger: {
      backgroundColor: colors.dangerSoft,
      borderColor: colors.dangerSoft
    },
    noticeLead: {
      color: colors.text,
      fontSize: typography.bodySize
    },
    noticeDetail: {
      color: colors.textSecondary,
      fontSize: typography.metaSize
    },
    noticeRetry: {
      alignSelf: 'flex-start',
      marginTop: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised
    },
    noticeRetryText: {
      color: colors.text,
      fontSize: typography.metaSize,
      fontWeight: '600'
    },
    noticeHolder: {
      paddingHorizontal: spacing.md
    },
    loading: {
      paddingVertical: spacing.xl,
      alignItems: 'center'
    },
    evidence: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      marginTop: spacing.xs
    },
    evidenceRole: {
      color: colors.textMuted,
      fontWeight: '600'
    },
    evidenceMatch: {
      color: colors.text,
      backgroundColor: colors.accentSoft,
      fontWeight: '600'
    },
    presence: {
      color: colors.warning,
      fontSize: typography.metaSize,
      marginTop: spacing.xs
    },
    footer: {
      alignItems: 'center',
      paddingVertical: spacing.md,
      gap: spacing.xs
    },
    loadMore: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised
    },
    loadMoreText: {
      color: colors.text,
      fontSize: typography.bodySize,
      fontWeight: '600'
    },
    loadMoreError: {
      color: colors.danger,
      fontSize: typography.metaSize,
      textAlign: 'center'
    },
    fallbackCaption: {
      color: colors.textMuted,
      fontSize: typography.metaSize,
      fontWeight: '600',
      textTransform: 'uppercase',
      paddingTop: spacing.sm
    }
  })
}
