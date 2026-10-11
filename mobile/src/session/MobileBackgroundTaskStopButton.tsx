import { Pressable, View } from 'react-native'
import { useTheme } from '../theme/theme-context'

/** A background task's own Stop, as the Claude Android app draws it: a 16 dp circle outline holding
 *  a 6 dp filled square, in the title's ink (measured off the Claude app, 2026-10-11; it was 24 dp in
 *  the muted ink, and read larger and heavier than Claude's). The 14 dp hit slop keeps the tap target
 *  at 44 dp (MIN_TAP_TARGET). `held` keeps it dim and dead while a Stop is on its way or confirmed (Orca #26780). */
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
      hitSlop={14}
      style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: held ? 0.4 : pressed ? 0.6 : 1 })}
    >
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          borderWidth: 1.25,
          borderColor: colors.text,
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <View style={{ width: 6, height: 6, borderRadius: 1, backgroundColor: colors.text }} />
      </View>
    </Pressable>
  )
}
