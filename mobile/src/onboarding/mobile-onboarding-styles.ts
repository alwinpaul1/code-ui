import { StyleSheet } from 'react-native'
import { radii, spacing, typography } from '../theme/mobile-theme'
import type { Theme } from '../theme/theme-context'

export function mobileOnboardingStyles({ colors }: Theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg
    },
    brandRow: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.xl
    },
    brandName: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '700'
    },
    progress: {
      position: 'absolute',
      left: '50%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      transform: [{ translateX: -18 }]
    },
    progressDot: {
      width: 7,
      height: 7,
      borderRadius: 999,
      backgroundColor: colors.border
    },
    progressDotActive: {
      width: 22,
      backgroundColor: colors.text
    },
    carouselViewport: {
      flex: 1,
      overflow: 'hidden'
    },
    carouselTrack: {
      height: '100%',
      flexDirection: 'row'
    },
    page: {
      height: '100%'
    },
    // Why: every decision remains reachable in landscape and with accessibility
    // text scaling even though Back and swipe-to-skip are intentionally disabled.
    pageContent: {
      flexGrow: 1,
      paddingHorizontal: spacing.xl
    },
    content: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: spacing.lg,
      paddingBottom: spacing.md
    },
    notificationContent: {
      justifyContent: 'flex-start',
      paddingTop: spacing.xl
    },
    iconSurface: {
      width: 64,
      height: 64,
      borderRadius: radii.card,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bgRaised,
      marginBottom: spacing.xl
    },
    title: {
      maxWidth: 420,
      color: colors.text,
      fontSize: 26,
      fontWeight: '700',
      letterSpacing: -0.3,
      textAlign: 'center'
    },
    body: {
      maxWidth: 420,
      color: colors.textSecondary,
      fontSize: typography.bodySize,
      lineHeight: 21,
      textAlign: 'center',
      marginTop: spacing.md
    },
    footer: {
      width: '100%',
      maxWidth: 420,
      alignSelf: 'center',
      paddingBottom: spacing.lg
    },
    // Was `surfaceBright`/`bgBase`: the near-white inverse-surface fill for the primary CTA, with
    // `textInverse` as its on-fill label — same pairing used for primary actions elsewhere.
    primaryButton: {
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.button,
      backgroundColor: colors.text,
      paddingVertical: spacing.sm
    },
    primaryButtonText: {
      color: colors.textInverse,
      fontSize: typography.bodySize,
      fontWeight: '600'
    },
    secondaryButton: {
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.button,
      marginTop: spacing.xs,
      paddingVertical: spacing.sm
    },
    secondaryButtonText: {
      color: colors.textSecondary,
      fontSize: typography.bodySize,
      fontWeight: '500'
    },
    buttonPressed: {
      opacity: 0.72
    },
    buttonDisabled: {
      opacity: 0.58
    },
    disclosure: {
      color: colors.textSecondary,
      fontSize: typography.metaSize,
      lineHeight: 18,
      textAlign: 'center',
      marginBottom: spacing.lg
    },
    error: {
      color: colors.danger,
      fontSize: typography.metaSize,
      lineHeight: 18,
      textAlign: 'center',
      marginBottom: spacing.sm
    }
  })
}
