import { useCallback, useEffect, useState, type RefObject } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import { useTheme } from '../theme/theme-context'

const STEPS = 10
const HEIGHT = 44

/** A soft top edge for the see-through dock: a short ramp from clear to the
 *  dock's own tint, so the conversation fades under the composer instead of
 *  meeting a hard line (2026-09-13, "there is a line or a box, remove it").
 *  Plain views, no gradient package: eight thin bands of rising alpha. */
export function DockFade() {
  const { colors } = useTheme()
  const rgb = colors.bgDock.replace(/rgba?\(([^)]+)\)/, '$1').split(',').slice(0, 3).join(',')
  const top = colors.bgDock.startsWith('rgba') ? Number(colors.bgDock.split(',')[3]) : 1
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, right: 0, top: -HEIGHT, height: HEIGHT }}
      testID="native-chat-dock-fade"
    >
      {Array.from({ length: STEPS }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            backgroundColor: `rgba(${rgb},${((top * (i + 1)) / (STEPS + 1)).toFixed(3)})`
          }}
        />
      ))}
    </View>
  )
}

/** The dock's measured height, which is the spacer at the list's end. When it
 *  changes while the reader sits at the live edge, re-pin, or the newest row
 *  ends up under the dock (2026-09-13, first open of 0.5.29). */
export function useChatDock(
  listRef: RefObject<{ scrollToOffset: (params: { offset: number; animated: boolean }) => void } | null>,
  isFollowing: () => boolean
): { dockHeight: number; onDockLayout: (event: LayoutChangeEvent) => void } {
  const [dockHeight, setDockHeight] = useState(0)
  useEffect(() => {
    if (dockHeight > 0 && isFollowing()) {
      listRef.current?.scrollToOffset({ offset: 0, animated: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dockHeight])
  const onDockLayout = useCallback(
    (event: LayoutChangeEvent) => setDockHeight(Math.round(event.nativeEvent.layout.height)),
    []
  )
  return { dockHeight, onDockLayout }
}
