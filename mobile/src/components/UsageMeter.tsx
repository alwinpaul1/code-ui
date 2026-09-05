import { ActivityIndicator, View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'

/**
 * One rate-limit window laid out the way the Claude app's Usage page does it:
 * the window name with "N% used" on the right, a rounded bar, then the reset
 * line underneath. `compact` is the Home-card column: name, percent, bar.
 */
export function UsageMeter({
  title,
  usedPercent,
  unavailable,
  loading,
  subtitle,
  compact = false,
  dense = false
}: {
  title: string
  usedPercent: number | null
  unavailable: boolean
  loading?: boolean
  /** Reset line, e.g. "Resets in 3 hr 34 min". */
  subtitle?: string | null
  compact?: boolean
  /** Home card: body-size title and percent, an 8px bar, the reset line as a caption. */
  dense?: boolean
}) {
  const { colors, space } = useTheme()
  const used = usedPercent == null ? null : Math.max(0, Math.min(100, Math.round(usedPercent)))
  // Why: one accent for the fill, like the Claude app; red only from 80% so a
  // limit about to bite still stands out.
  const fill =
    used == null || unavailable ? colors.textMuted : used >= 80 ? colors.danger : colors.accent
  const percentText = unavailable || used == null ? '—' : compact ? `${used}%` : `${used}% used`
  return (
    <View style={{ gap: compact ? 6 : dense ? space.sm : space.sm + 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
        <Txt
          variant={compact ? 'caption' : dense ? 'body' : 'heading'}
          weight={compact ? 'regular' : 'medium'}
          tone={compact ? 'muted' : 'primary'}
          style={{ flex: 1 }}
          numberOfLines={1}
        >
          {title}
        </Txt>
        {loading ? (
          <ActivityIndicator size="small" color={colors.textMuted} />
        ) : (
          <Txt
            variant={compact ? 'caption' : 'body'}
            weight={compact ? 'medium' : 'regular'}
            tone={compact ? 'primary' : 'secondary'}
          >
            {percentText}
          </Txt>
        )}
      </View>
      <View
        style={{
          height: compact ? 6 : dense ? 8 : 10,
          borderRadius: 5,
          backgroundColor: colors.bgSunken,
          overflow: 'hidden'
        }}
      >
        <View
          style={{
            width: `${used ?? 0}%`,
            height: '100%',
            borderRadius: 5,
            backgroundColor: fill
          }}
        />
      </View>
      {subtitle && !compact ? (
        <Txt
          variant={dense ? 'caption' : 'body'}
          tone={dense ? 'muted' : 'secondary'}
          numberOfLines={1}
        >
          {subtitle}
        </Txt>
      ) : null}
    </View>
  )
}
