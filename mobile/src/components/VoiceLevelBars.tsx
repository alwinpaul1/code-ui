import { View } from 'react-native'
import { useTheme } from '../theme/theme-context'

const BAR_COUNT = 5
// Each bar leans on the level a little differently so the row breathes
// instead of moving as one block (Claude Code's voice meter does the same).
const BAR_WEIGHTS = [0.55, 0.85, 1, 0.8, 0.6]

/** Five thin bars that rise with the microphone level and settle when quiet. */
export function VoiceLevelBars({ level, height = 18 }: { level: number; height?: number }) {
  const { colors } = useTheme()
  const clamped = Math.max(0, Math.min(1, level))
  return (
    <View
      accessibilityLabel="Listening"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height, paddingHorizontal: 6 }}
    >
      {BAR_WEIGHTS.slice(0, BAR_COUNT).map((weight, index) => {
        const barHeight = Math.max(3, Math.round(height * (0.18 + 0.82 * clamped * weight)))
        return (
          <View
            key={index}
            style={{
              width: 3,
              height: barHeight,
              borderRadius: 1.5,
              backgroundColor: clamped > 0.05 ? colors.danger : colors.textMuted
            }}
          />
        )
      })}
    </View>
  )
}
