import { View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from './Txt'

/** One line of feedback floating over the foot of a screen, painted from the live theme. Nothing
 *  when there is no message. Touches pass through it. */
export function FloatingToast({ message }: { message: string | null }) {
  const { colors, radius, space } = useTheme()
  if (!message) {
    return null
  }
  return (
    <View
      pointerEvents="none"
      style={{
        alignItems: 'center',
        bottom: space.xl,
        left: 0,
        position: 'absolute',
        right: 0
      }}
    >
      <View
        style={{
          backgroundColor: colors.bgRaised,
          borderColor: colors.border,
          borderRadius: radius.lg,
          borderWidth: 1,
          maxWidth: '86%',
          paddingHorizontal: space.md + 2,
          paddingVertical: space.sm
        }}
      >
        <Txt variant="caption">{message}</Txt>
      </View>
    </View>
  )
}
