import { useMemo, useRef, useState } from 'react'
import { Gesture } from 'react-native-gesture-handler'
import type { ComposedGesture } from 'react-native-gesture-handler'
import { useChatTextScale } from '../settings/chat-reading-settings'
import { quantizeFontScale } from './mobile-native-chat-message-text'

/** Pinch-to-zoom chat font. `fontScale` is the committed size; `pinchBase` anchors the live
 *  gesture so successive pinches compound rather than reset.
 *
 *  It starts from the size the reader chose in Settings (Small 0.85, Medium 1.0, Large 1.15:
 *  chat-reading-settings.ts), not from 1, and a pinch goes on from there. Choosing another size
 *  moves the transcript to it and drops the pinch, as the Claude app's setting would. The three
 *  sizes sit on the pinch's own 0.05 grid, so a start from one is already a committed value. */
export function useMobileNativeChatPinchGesture(): {
  fontScale: number
  pinchGesture: ComposedGesture
} {
  const chosen = useChatTextScale()
  const [pinched, setPinched] = useState({ chosen, scale: chosen })
  let current = pinched
  if (pinched.chosen !== chosen) {
    // Derived from the prop during render, so no frame draws the old size under the new choice.
    current = { chosen, scale: chosen }
    setPinched(current)
  }
  const fontScale = current.scale
  const fontScaleRef = useRef(fontScale)
  fontScaleRef.current = fontScale
  const pinchBase = useRef(fontScale)
  // Why: run the gesture callbacks on the JS thread (not a reanimated worklet) so
  // they can touch React refs/state and quantizeFontScale directly — accessing
  // those from the UI-thread worklet crashes the app.
  // Compose the pinch with the list's native scroll as Simultaneous so a
  // two-finger pinch is recognized even while the scroll view is active —
  // otherwise the scroll grabs the gesture first and the pinch never fires.
  const pinchGesture = useMemo(
    () =>
      Gesture.Simultaneous(
        Gesture.Native(),
        Gesture.Pinch()
          .runOnJS(true)
          .onStart(() => {
            pinchBase.current = fontScaleRef.current
          })
          .onUpdate((e) => {
            const scale = quantizeFontScale(pinchBase.current * e.scale)
            setPinched((now) => (now.scale === scale ? now : { chosen: now.chosen, scale }))
          })
      ),
    []
  )

  return { fontScale, pinchGesture }
}
