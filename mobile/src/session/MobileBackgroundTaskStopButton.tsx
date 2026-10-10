import { Pressable, View } from 'react-native'
import { useTheme } from '../theme/theme-context'

/** A background task's own Stop, as the Claude Android app draws it: a round button, a circle
 *  outline holding a filled square, in the muted foreground. `held` keeps it dim and dead while a
 *  Stop is on its way or confirmed (Orca #26780). */
export function MobileBackgroundTaskStopButton({
  title,
  held = false,
  onPress
}: {
  title: string
  held?: boolean
  onPress: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Stop ${title}`}
      onPress={onPress}
      disabled={held}
      accessibilityState={{ disabled: held }}
      hitSlop={10}
      style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: held ? 0.4 : pressed ? 0.6 : 1 })}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: 1.5,
          borderColor: colors.textSecondary,
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <View style={{ width: 8, height: 8, borderRadius: 1.5, backgroundColor: colors.textSecondary }} />
      </View>
    </Pressable>
  )
}
