import { ActivityIndicator, View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'

/**
 * One rate-limit window as a stacked block, the way the Claude app's Usage
 * page lays it out: name and percent on one line, a full-width bar, then the
 * reset time. Three of these read cleanly where three inline bars did not.
 */
export function UsageMeter({
  title,
  usedPercent,
  unavailable,
  loading,
  resetText,
  compact = false
}: {
  title: string
  usedPercent: number | null
  unavailable: boolean
  loading?: boolean
  resetText?: string | null
  /** Home-card column: percent only, no "used" suffix, tighter spacing. */
  compact?: boolean
}) {
  const { colors, space } = useTheme()
  const used = usedPercent == null ? null : Math.max(0, Math.min(100, Math.round(usedPercent)))
  // Same consumption bands as the desktop status bar: calm below 60, amber
  // below 80, red from 80 up.
  const fill =
    used == null || unavailable
      ? colors.textMuted
      : used >= 80
        ? colors.danger
        : used >= 60
          ? colors.warning
          : colors.success
  return (
    <View style={{ gap: compact ? 3 : 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.xs }}>
        <Txt
          variant="caption"
          tone={compact ? 'muted' : 'secondary'}
          style={{ flex: 1 }}
          numberOfLines={1}
        >
          {title}
        </Txt>
        {loading ? (
          <ActivityIndicator size="small" color={colors.textMuted} />
        ) : (
          <Txt variant="caption" weight="medium" tone={unavailable ? 'muted' : 'primary'}>
            {unavailable || used == null ? '—' : compact ? `${used}%` : `${used}% used`}
          </Txt>
        )}
      </View>
      <View
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: colors.bgSunken,
          overflow: 'hidden'
        }}
      >
        <View
          style={{
            width: `${used ?? 0}%`,
            height: '100%',
            borderRadius: 3,
            backgroundColor: fill
          }}
        />
      </View>
      {resetText ? (
        <Txt variant="caption" tone="muted" numberOfLines={1}>
          {resetText}
        </Txt>
      ) : null}
    </View>
  )
}
