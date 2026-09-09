import { Pressable } from 'react-native'
import Animated from 'react-native-reanimated'
import Svg, { Circle } from 'react-native-svg'
import { useTheme } from '../theme/theme-context'
import { useUsageProgress } from './use-usage-progress'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

/** Small ring showing how much of the model's context window is used; taps
 *  open the detail sheet. The arc and its colour ease to each new reading:
 *  green while calm, amber by 70, red from 90. */
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
  const { ringProps } = useUsageProgress(pct, circumference)
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
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
          animatedProps={ringProps}
        />
      </Svg>
    </Pressable>
  )
}
