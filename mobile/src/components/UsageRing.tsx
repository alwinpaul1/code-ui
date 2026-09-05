import { ActivityIndicator, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'

import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { usageTone } from './usage-window-summary'

/**
 * A ring gauge for one rate-limit window, the shape Revolut and Vivid use for
 * "used of limit". The number sits inside; the caller labels the window.
 */
export function UsageRing({
  usedPercent,
  unavailable = false,
  loading = false,
  size = 72,
  strokeWidth = 7,
  caption
}: {
  usedPercent: number | null
  unavailable?: boolean
  loading?: boolean
  size?: number
  strokeWidth?: number
  /** Small word under the number, e.g. "used". Omit on tiny rings. */
  caption?: string
}) {
  const { colors } = useTheme()
  const used =
    usedPercent == null || unavailable ? null : Math.max(0, Math.min(100, Math.round(usedPercent)))
  const tone = usageTone(used)
  const stroke =
    tone === 'danger'
      ? colors.danger
      : tone === 'warning'
        ? colors.warning
        : tone === 'success'
          ? colors.success
          : colors.textMuted
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dash = circumference * ((used ?? 0) / 100)
  const big = size >= 64
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: used ?? 0 }}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.bgSunken}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {used != null && used > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${dash} ${circumference - dash}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      {loading ? (
        <ActivityIndicator size="small" color={colors.textMuted} />
      ) : (
        <View style={{ alignItems: 'center' }}>
          <Txt
            variant={big ? 'heading' : 'caption'}
            weight="semibold"
            tone={used == null ? 'muted' : 'primary'}
          >
            {used == null ? '—' : `${used}%`}
          </Txt>
          {big && caption ? (
            <Txt variant="caption" tone="muted" style={{ marginTop: -2 }}>
              {caption}
            </Txt>
          ) : null}
        </View>
      )}
    </View>
  )
}
