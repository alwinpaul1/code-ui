import { useCallback, useEffect, useRef, useState } from 'react'
import { createChatFollowGate } from './mobile-chat-follow-gate'
import { isReaderScrollMotion, type ChatScrollGeometry } from './mobile-chat-scroll-motion'
import { useAppInterruptions } from './use-app-interruptions'

/** A finger held this long is a long-press — Android's text-selection
 *  timeout is 400 ms — and from then on the reader owns the list, as with a
 *  drag: the agent's streaming must not move the text they are selecting
 *  (screen recording, 2026-09-12 22:49). A shorter touch is a tap. */
const LONG_PRESS_MS = 400

/** How long the list must go without a sample of it moving, with the finger
 *  up, before it counts as at rest without an end event. Longer than a frame
 *  of a slow fling (samples arrive every 16 ms while anything moves), shorter
 *  than a reader's next hold. */
const QUIET_MS = 250

/** A drag owns scrolling until it settles, even inside the live-edge threshold.
 *  While it does, chat text is not selectable: Android arms a text-selection
 *  long-press under any selectable Text, and a finger put down to stop a fling
 *  and held tripped it — a buzz from nowhere and a stray selection
 *  (2026-09-12). Only new data may pull the list to the live edge; see
 *  `mobile-chat-follow-gate.ts` for the press-and-hold jump that rule ends. */
export function useMobileChatFollowing() {
  const followingRef = useRef(true)
  const scrollingRef = useRef(false)
  const followGate = useRef(createChatFollowGate()).current
  const holdingRef = useRef(false)
  const touchStartedAt = useRef(0)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const [textSelectable, setTextSelectable] = useState(true)
  const setFollowing = useCallback((next: boolean) => {
    followingRef.current = next
    setShowJumpToLatest((visible) => (visible === !next ? visible : !next))
  }, [])
  // The END events are not enough to bring selection back. A fling that a
  // re-anchor or a nested scroll view interrupts sends no momentum-end, and
  // the flag then sat false until the reader's next clean scroll: a hold on
  // a list that had been still for half a second selected nothing (phone
  // recording, 2026-09-21). The finger lifting and the list no longer moving
  // are the evidence that it is at rest, so those restore it too. A finger
  // still down after beginning a drag, or put down to stop a fling, keeps
  // selection off until it lifts: the 2026-09-12 rule.
  const quietTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // A finger dragging the list, from the drag's begin to its end. `holding`
  // cannot say so on Android: when the scroll view takes a gesture, JS gets a
  // touchcancel before the drag begins and no touchend when the finger lifts,
  // so `holding` reads false for every drag. Without this the window closed
  // under a finger that had caught a fling and held still, and after a drag
  // paused a quarter of a second, and the next sample near the live edge
  // handed the list back to tail-follow mid-drag (second review, 2026-09-25).
  const draggingRef = useRef(false)
  const cancelQuiet = useCallback(() => {
    if (quietTimer.current !== null) {
      clearTimeout(quietTimer.current)
      quietTimer.current = null
    }
  }, [])
  const armQuiet = useCallback(() => {
    cancelQuiet()
    if (!scrollingRef.current || holdingRef.current || draggingRef.current) {
      return
    }
    quietTimer.current = setTimeout(() => {
      quietTimer.current = null
      if (scrollingRef.current && !holdingRef.current && !draggingRef.current) {
        scrollingRef.current = false
        setTextSelectable(true)
      }
    }, QUIET_MS)
  }, [cancelQuiet])
  const startScroll = useCallback(() => {
    scrollingRef.current = true
    setTextSelectable(false)
    setFollowing(false)
  }, [setFollowing])
  /** A drag: a finger on the list, so the window waits for it to lift. */
  const beginScroll = useCallback(() => {
    draggingRef.current = true
    cancelQuiet()
    startScroll()
  }, [cancelQuiet, startScroll])
  /** The dragging finger lifted; if nothing moves now, the list is at rest. */
  const endDrag = useCallback(() => {
    draggingRef.current = false
    armQuiet()
  }, [armQuiet])
  // A fling begins with the finger already up and is only presumed to move:
  // the window opens at once and each sample of it moving starts it over.
  // Waiting instead for the momentum end left text unselectable for a whole
  // turn, because Android sends that end only after three quiet checks with
  // no scroll at all, and a streaming reply scrolls the list every time it
  // grows (`NATIVE_CHAT_STREAM_THROTTLE_MS`, 50 ms) while it holds the
  // reader's place (2026-09-25).
  const beginFling = useCallback(() => {
    draggingRef.current = false
    startScroll()
    armQuiet()
  }, [armQuiet, startScroll])
  const endScroll = useCallback(() => {
    scrollingRef.current = false
    cancelQuiet()
    setTextSelectable(true)
  }, [cancelQuiet])
  const lastSample = useRef<ChatScrollGeometry | null>(null)
  /** A scroll sample while a scroll is in flight. If the list moved under the
   *  reader, the quiet window starts over. If it only held their place while
   *  the content grew (`isReaderScrollMotion`), it proves nothing about the
   *  reader's scroll, and the window runs on. */
  const scrollSample = useCallback(
    (geometry: ChatScrollGeometry) => {
      const moved = isReaderScrollMotion(lastSample.current, geometry)
      lastSample.current = geometry
      if (scrollingRef.current && moved) {
        armQuiet()
      }
    },
    [armQuiet]
  )
  // Armed on touch-down, disarmed on release: control passes at the long-press
  // mark while the finger is STILL DOWN, not when it lifts.
  //
  // Waiting for the lift was the whole press-and-hold drift bug (reported
  // 2026-09-15). The list's native scroll anchoring is configured from the jump
  // flag — `{ disabled: !showJumpToLatest }` in `mobile-native-chat-list-extra-
  // data.ts` — so for as long as the reader still counts as following, nothing
  // holds the content still. The reader holds a word to select it, the agent
  // streams underneath, and the selection slides off the screen before the
  // finger ever comes up. Flipping intent at 400 ms turns the anchoring on for
  // the rest of the hold, which is precisely when it is needed.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disarmLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])
  const touchStart = useCallback(() => {
    holdingRef.current = true
    // A new gesture: any drag before it is over, even one whose end the
    // scroll view never sent (a cancelled gesture sends none).
    draggingRef.current = false
    touchStartedAt.current = Date.now()
    cancelQuiet()
    disarmLongPress()
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null
      // Only while the finger is still down: a release disarms this.
      if (holdingRef.current) {
        setFollowing(false)
      }
    }, LONG_PRESS_MS)
  }, [cancelQuiet, disarmLongPress, setFollowing])
  const touchEnd = useCallback(() => {
    holdingRef.current = false
    // Android sends this (as a touchcancel) BEFORE a drag begins, never
    // after; a touchend that follows a drag's begin is a finger JS saw lift.
    draggingRef.current = false
    disarmLongPress()
    // Kept for the case the timer could not run (a backgrounded app, a test
    // with no timers): the elapsed time still says this was a long-press.
    if (Date.now() - touchStartedAt.current >= LONG_PRESS_MS) {
      setFollowing(false)
    }
    // The finger is up; if the list is not moving either, selection returns.
    armQuiet()
  }, [armQuiet, disarmLongPress, setFollowing])
  // The system took the touch: a home swipe, a call, the screen locking. A
  // drag it cancels sends no end event, so without this the text stayed
  // unselectable and the first hold back in the app selected nothing (third
  // review, 2026-09-25). No finger survives it; if the list is not moving,
  // selection returns.
  const interruptGesture = useCallback(() => {
    holdingRef.current = false
    draggingRef.current = false
    disarmLongPress()
    armQuiet()
  }, [armQuiet, disarmLongPress])
  useAppInterruptions(interruptGesture)
  useEffect(
    () => () => {
      disarmLongPress()
      cancelQuiet()
    },
    [cancelQuiet, disarmLongPress]
  )
  return {
    followingRef,
    scrollingRef,
    holdingRef,
    draggingRef,
    touchStart,
    touchEnd,
    scrollSample,
    followGate,
    textSelectable,
    showJumpToLatest,
    setFollowing,
    beginScroll,
    endDrag,
    beginFling,
    endScroll
  }
}
