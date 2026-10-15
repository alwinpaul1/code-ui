import { View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'

/** The Claude app's time header above a message (1.261013.20, drawn by `ay8`):
 *  the time alone as a plain caption, centred, in the muted text colour, so it
 *  follows both themes. The wavy rule either side of it is gone (2026-10-15). */
export function MobileNativeChatTimeDivider({ label }: { label: string }) {
  const { space } = useTheme()
  return (
    <View
      style={{ alignItems: 'center', paddingVertical: space.lg }}
      accessibilityRole="text"
      accessibilityLabel={label}
      testID="chat-time-divider"
    >
      <Txt variant="caption" tone="muted" align="center">
        {label}
      </Txt>
    </View>
  )
}
