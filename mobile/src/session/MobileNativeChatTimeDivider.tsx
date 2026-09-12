import { View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'

const WAVE_HEIGHT = 6
const WAVE_LENGTH = 12

/** The Claude app's rule between messages that a pause separates: a wavy
 *  line either side of the time (2026-09-13). Drawn in the muted text colour
 *  so it works on both themes. */
export function MobileNativeChatTimeDivider({ label }: { label: string }) {
  const { colors, space } = useTheme()
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.lg }}
      accessibilityRole="text"
      accessibilityLabel={`Later, ${label}`}
      testID="chat-time-divider"
    >
      <Wave color={colors.textMuted} />
      <Txt variant="caption" tone="muted">
        {label}
      </Txt>
      <Wave color={colors.textMuted} />
    </View>
  )
}

function Wave({ color }: { color: string }) {
  // Draw enough periods for the widest phone; the flex box clips the rest.
  const periods = 40
  let d = `M0 ${WAVE_HEIGHT / 2}`
  for (let i = 0; i < periods; i++) {
    d += ` q${WAVE_LENGTH / 4} -${WAVE_HEIGHT / 2} ${WAVE_LENGTH / 2} 0 t${WAVE_LENGTH / 2} 0`
  }
  return (
    <View style={{ flex: 1, height: WAVE_HEIGHT + 2, overflow: 'hidden' }}>
      <Svg width={periods * WAVE_LENGTH} height={WAVE_HEIGHT + 2}>
        <Path d={d} stroke={color} strokeWidth={1.2} fill="none" strokeOpacity={0.7} />
      </Svg>
    </View>
  )
}
