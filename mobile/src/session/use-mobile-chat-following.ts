import { useCallback, useEffect, useRef, useState } from 'react'
import { createChatFollowGate } from './mobile-chat-follow-gate'

/** A finger held this long is a long-press — Android's text-selection
 *  timeout is 400 ms — and from then on the reader owns the list, as with a
 *  drag: the agent's streaming must not move the text they are selecting
 *  (screen recording, 2026-09-12 22:49). A shorter touch is a tap. */
const LONG_PRESS_MS = 400

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
  const beginScroll = useCallback(() => {
    scrollingRef.current = true
    setTextSelectable(false)
    setFollowing(false)
  }, [setFollowing])
  const endScroll = useCallback(() => {
    scrollingRef.current = false
    setTextSelectable(true)
  }, [])
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
    touchStartedAt.current = Date.now()
    disarmLongPress()
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null
      // Only while the finger is still down: a release disarms this.
      if (holdingRef.current) {
        setFollowing(false)
      }
    }, LONG_PRESS_MS)
  }, [disarmLongPress, setFollowing])
  const touchEnd = useCallback(() => {
    holdingRef.current = false
    disarmLongPress()
    // Kept for the case the timer could not run (a backgrounded app, a test
    // with no timers): the elapsed time still says this was a long-press.
    if (Date.now() - touchStartedAt.current >= LONG_PRESS_MS) {
      setFollowing(false)
    }
  }, [disarmLongPress, setFollowing])
  useEffect(() => disarmLongPress, [disarmLongPress])
  return {
    followingRef,
    scrollingRef,
    holdingRef,
    touchStart,
    touchEnd,
    followGate,
    textSelectable,
    showJumpToLatest,
    setFollowing,
    beginScroll,
    endScroll
  }
}
