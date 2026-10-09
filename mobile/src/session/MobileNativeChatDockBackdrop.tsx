import { View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { useTheme } from '../theme/theme-context'

/** How far above the dock the ground fades in, in dp. */
export const DOCK_BACKDROP_FADE = 28

/**
 * The ground behind the dock (the status row, the tool strip and the
 * composer's margins): the page colour, with a short fade into it above the
 * dock so a line of the transcript passing under it goes quiet instead of
 * stopping at a hard edge. Without it the transcript's words and the row's
 * were painted on top of each other (device, 2026-10-09). A flat ground read
 * as a line above the row each time it was tried (2026-09-13, 09-19, 09-20),
 * which the fade is for. Absolutely placed, so the dock's measured height
 * (and the list spacer that clears it) does not change, and it takes no
 * touches, so a swipe begun on the row still scrolls the list.
 */
export function MobileNativeChatDockBackdrop() {
  const { colors } = useTheme()
  return (
    <View
      pointerEvents="none"
      testID="native-chat-dock-backdrop"
      style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
    >
      <View
        testID="native-chat-dock-backdrop-fade"
        style={{ position: 'absolute', top: -DOCK_BACKDROP_FADE, height: DOCK_BACKDROP_FADE, left: 0, right: 0 }}
      >
        <Svg width="100%" height={DOCK_BACKDROP_FADE}>
          <Defs>
            <LinearGradient id="dockFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.bg} stopOpacity={0} />
              <Stop offset="1" stopColor={colors.bg} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#dockFade)" />
        </Svg>
      </View>
      <View
        testID="native-chat-dock-backdrop-solid"
        style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colors.bg }}
      />
    </View>
  )
}
