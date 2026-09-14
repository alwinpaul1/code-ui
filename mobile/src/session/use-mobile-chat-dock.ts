import { useCallback, useEffect, useState } from 'react'
import type { LayoutChangeEvent } from 'react-native'

/** The dock's measured height, which is the spacer at the list's end. When it
 *  changes while the reader sits at the live edge, re-pin, or the newest row
 *  ends up under the dock (2026-09-13, first open of 0.5.29).
 *
 *  The re-pin goes through the tail-follow owner's `pinToTail`, which is the
 *  one caller allowed to move the list and already refuses while the reader
 *  holds it — this hook no longer reaches for the list's ref itself. */
export function useChatDock(pinToTail: () => void): {
  dockHeight: number
  onDockLayout: (event: LayoutChangeEvent) => void
} {
  const [dockHeight, setDockHeight] = useState(0)
  useEffect(() => {
    if (dockHeight > 0) {
      pinToTail()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dockHeight])
  const onDockLayout = useCallback(
    (event: LayoutChangeEvent) => setDockHeight(Math.round(event.nativeEvent.layout.height)),
    []
  )
  return { dockHeight, onDockLayout }
}
