import { Switch, Text, View } from 'react-native'
import { spacing, typography } from '../theme/mobile-theme'
import { useTheme } from '../theme/theme-context'

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
  const { colors } = useTheme()
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
        <Text style={{ color: colors.text, fontSize: typography.bodySize }}>{label}</Text>
        <Text style={{ color: colors.textMuted, fontSize: typography.metaSize }}>{sublabel}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
        thumbColor={colors.text}
      />
    </View>
  )
}
