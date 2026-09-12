import { useCallback, useRef, useState } from 'react'
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
  const touchStart = useCallback(() => {
    holdingRef.current = true
    touchStartedAt.current = Date.now()
  }, [])
  const touchEnd = useCallback(() => {
    holdingRef.current = false
    if (Date.now() - touchStartedAt.current >= LONG_PRESS_MS) {
      setFollowing(false)
    }
  }, [setFollowing])
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
