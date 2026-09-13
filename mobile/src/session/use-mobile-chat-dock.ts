import { useCallback, useEffect, useState, type RefObject } from 'react'
import type { LayoutChangeEvent } from 'react-native'

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
