import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { RotateCcw } from 'lucide-react-native'
import { radii, spacing, typography } from '../theme/mobile-theme'
import { useTheme, useThemedStyles, type Theme } from '../theme/theme-context'
import type { CodexResetCreditSummary } from './codex-reset-credit'

export function CodexResetCreditAction({
  summary,
  scopeLabel,
  busy,
  disabled,
  onPress
}: {
  summary: CodexResetCreditSummary
  scopeLabel?: string | null
  busy: boolean
  disabled: boolean
  onPress: () => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(codexResetCreditActionStyles)
  return (
    <>
      <View style={styles.separator} />
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text style={styles.title}>{summary.availabilityLabel}</Text>
          <Text style={styles.subtitle}>
            {[summary.expiryLabel, scopeLabel].filter(Boolean).join(' · ') ||
              'Earned Codex rate-limit reset'}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            disabled && styles.buttonDisabled,
            pressed && !disabled && styles.buttonPressed
          ]}
          onPress={onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={busy ? 'Resetting Codex rate limits' : 'Use Codex rate-limit reset'}
          accessibilityHint={
            scopeLabel
              ? `Uses one earned reset for ${scopeLabel}`
              : 'Uses one earned reset for the active Codex account'
          }
          accessibilityState={{ busy, disabled }}
          hitSlop={8}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <RotateCcw size={14} color={colors.text} />
          )}
          <Text style={styles.buttonText}>{busy ? 'Resetting…' : 'Use reset'}</Text>
        </Pressable>
      </View>
    </>
  )
}

function codexResetCreditActionStyles({ colors }: Theme) {
  return StyleSheet.create({
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginHorizontal: spacing.md
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md + 2
    },
    copy: {
      flex: 1,
      gap: spacing.xs
    },
    title: {
      fontSize: typography.bodySize,
      fontWeight: '500',
      color: colors.text
    },
    subtitle: {
      fontSize: typography.metaSize,
      color: colors.textSecondary
    },
    button: {
      minHeight: 44,
      width: 104,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radii.button,
      backgroundColor: colors.bgRaised
    },
    buttonPressed: {
      opacity: 0.72
    },
    buttonDisabled: {
      opacity: 0.5
    },
    buttonText: {
      fontSize: typography.metaSize,
      fontWeight: '600',
      color: colors.text
    }
  })
}
