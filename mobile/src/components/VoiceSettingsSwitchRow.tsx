import { Switch, Text, View } from 'react-native'
import { colors, spacing, typography } from '../theme/mobile-theme'

/** One labelled switch row of the Voice settings card. */
export function VoiceSettingsSwitchRow({
  label,
  sublabel,
  value,
  onValueChange
}: {
  label: string
  sublabel: string
  value: boolean
  onValueChange: (value: boolean) => void
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm + 2,
        paddingHorizontal: spacing.md + 2,
        paddingVertical: spacing.md
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.textPrimary, fontSize: typography.bodySize }}>{label}</Text>
        <Text style={{ color: colors.textMuted, fontSize: typography.metaSize }}>{sublabel}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
        thumbColor={colors.textPrimary}
      />
    </View>
  )
}
