import { useCallback, useRef, useState } from 'react'

/** A drag owns scrolling until it settles, even inside the live-edge threshold. */
export function useMobileChatFollowing() {
  const followingRef = useRef(true)
  const scrollingRef = useRef(false)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const setFollowing = useCallback((next: boolean) => {
    followingRef.current = next
    setShowJumpToLatest((visible) => (visible === !next ? visible : !next))
  }, [])
  const beginScroll = useCallback(() => {
    scrollingRef.current = true
    setFollowing(false)
  }, [setFollowing])
  const endScroll = useCallback(() => {
    scrollingRef.current = false
  }, [])
  return { followingRef, scrollingRef, showJumpToLatest, setFollowing, beginScroll, endScroll }
}
