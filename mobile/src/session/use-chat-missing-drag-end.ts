import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { NativeScrollEvent } from 'react-native'
import { logChatScroll } from './chat-scroll-log'

/** How long after the list's scroll gesture ends a drag may still report its own end before the
 *  hook ends it instead. The gesture's end reaches JS as a device event, sent at once; the scroll
 *  view's end-drag and momentum-begin go through the event dispatcher, which flushes on the next
 *  frame, so on a plain lift they can land a frame AFTER the gesture's end. Settling in that frame
 *  handed a flick at the live edge back to tail-follow for the length of its fling. */
export const MISSING_DRAG_END_GRACE_MS = 120

/**
 * The end of a chat drag that React Native's Android ScrollView never sends.
 *
 * The Claude app's list ends a drag when its drag interaction stops OR is cancelled; a cancel is a
 * lift as far as following goes. ReactScrollView sends its end-drag only for ACTION_UP
 * (ReactScrollView.onTouchEvent): a cancel — the system taking the touch for a back or home swipe,
 * gesture-handler cancelling the list's Native gesture — leaves the drag open with no end, no
 * fling and no momentum events (the user's "stuck" scroll, 2026-10-17). Whatever ends an open drag
 * instead says so in one `[chat-scroll]` line, naming the signal.
 */
export function useChatMissingDragEnd(draggingRef: RefObject<boolean>) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The last sample the list sent: where a drag with no end of its own came to rest.
  const lastMetricsRef = useRef<NativeScrollEvent | null>(null)
  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])
  useEffect(() => cancel, [cancel])
  const noteSample = useCallback((metrics: NativeScrollEvent) => {
    lastMetricsRef.current = metrics
  }, [])
  /** A signal that ends any drag still open (a new touch down, a fling's start): says so. */
  const endedBy = useCallback(
    (signal: string) => {
      cancel()
      if (draggingRef.current) {
        logChatScroll(`drag end missing, ended by ${signal}`)
      }
    },
    [cancel, draggingRef]
  )
  /** The list's scroll gesture ended, lifted or cancelled. If its drag reports no end within the
   *  grace, `finish` ends it from the last sample, as the end-drag would have. */
  const gestureEnded = useCallback(
    (cancelled: boolean, finish: (metrics: NativeScrollEvent | null) => void) => {
      if (!draggingRef.current) {
        return
      }
      cancel()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (draggingRef.current) {
          logChatScroll(`drag end missing, ended by the scroll gesture's ${cancelled ? 'cancel' : 'end'}`)
          finish(lastMetricsRef.current)
        }
      }, MISSING_DRAG_END_GRACE_MS)
    },
    [cancel, draggingRef]
  )
  const lastSample = useCallback(() => lastMetricsRef.current, [])
  return { cancel, noteSample, lastSample, endedBy, gestureEnded }
}
