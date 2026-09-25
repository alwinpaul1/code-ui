import { useEffect, useRef } from 'react'
import type { MobileNativeChatSession } from './use-mobile-native-chat-session'
import { isTakenSend } from './mobile-native-chat-pending-echo'

/** A small live window can omit a delivered photo before its saved preview is
 * rebound. Read older pages in the background without delaying the live chat.
 * Not for a photo the agent took mid-turn: no row of it exists to find
 * (isTakenSend). */
export function usePendingImageHistory(
  session: MobileNativeChatSession,
  pending: readonly { id: string; images?: string[]; takenAt?: number }[],
  scope: string
): void {
  const withImages = pending.filter((item) => item.images?.length && !isTakenSend(item))
  const key = `${scope}\0${withImages.map((item) => item.id).join(',')}`
  const attempts = useRef({ key, count: 0 })
  const { hasMore, loadingEarlier, transcriptLoading, loadEarlier } = session
  const hasImages = withImages.length > 0
  useEffect(() => {
    if (attempts.current.key !== key) {
      attempts.current = { key, count: 0 }
    }
    if (
      !hasImages ||
      !hasMore ||
      loadingEarlier ||
      transcriptLoading ||
      attempts.current.count >= 4
    ) {
      return
    }
    const timer = setTimeout(() => {
      attempts.current.count += 1
      loadEarlier()
    }, 1000)
    return () => clearTimeout(timer)
  }, [key, hasImages, hasMore, loadingEarlier, transcriptLoading, loadEarlier])
}
