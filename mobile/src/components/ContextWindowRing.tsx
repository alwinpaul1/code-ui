import { Pressable } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { useTheme } from '../theme/theme-context'

/** Small ring showing how much of the model's context window is used; taps
 *  open the detail sheet. Colours follow Claude Code: calm, amber past 70,
 *  red past 90. */
export function ContextWindowRing({
  usedPercent,
  onPress,
  size = 18
}: {
  usedPercent: number
  onPress?: () => void
  size?: number
}) {
  const { colors } = useTheme()
  const pct = Math.max(0, Math.min(100, usedPercent))
  const stroke = 2.5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const color = pct >= 90 ? colors.danger : pct >= 70 ? colors.warning : colors.info
  return (
    <Pressable
      accessibilityLabel={`Context window ${Math.round(pct)}% used`}
      accessibilityRole="button"
      hitSlop={10}
      onPress={onPress}
      style={{
        flexShrink: 0,
        width: size + 8,
        height: size + 8,
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.border}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - pct / 100)}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
    </Pressable>
  )
}
