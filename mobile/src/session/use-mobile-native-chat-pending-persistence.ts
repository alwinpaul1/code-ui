import { useEffect, type Dispatch, type SetStateAction } from 'react'
import {
  readNativeChatPendingEchoes,
  writeNativeChatPendingEchoes
} from '../storage/native-chat-pending-echoes'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

const PENDING_WRITE_DEBOUNCE_MS = 250

type PendingBySession = Record<string, MobileNativeChatPendingMessage[]>

/**
 * Keeps a session's optimistic echoes on disk: hydrates them the first time
 * the session is shown and mirrors changes back with a trailing debounce, so
 * a message queued behind a busy agent is still on screen after the route
 * unmounts (opening another project) and comes back. Retirement against the
 * transcript works on the hydrated copy exactly as on the live one.
 */
export function useMobileNativeChatPendingPersistence(
  sessionKey: string | null,
  pendingBySession: PendingBySession,
  setPendingBySession: Dispatch<SetStateAction<PendingBySession>>
): void {
  // Why not skip when the session already has entries: a send made in the
  // moment before the stored list loads must not cancel the load; the two
  // lists merge by id, stored first.
  useEffect(() => {
    if (!sessionKey) {
      return
    }
    let cancelled = false
    void readNativeChatPendingEchoes(sessionKey).then((stored) => {
      if (cancelled || !stored || stored.length === 0) {
        return
      }
      // Sends made meanwhile come after the stored ones, in send order.
      setPendingBySession((previous) => {
        const live = previous[sessionKey] ?? []
        const liveIds = new Set(live.map((item) => item.id))
        return {
          ...previous,
          [sessionKey]: [...stored.filter((item) => !liveIds.has(item.id)), ...live]
        }
      })
    })
    return () => {
      cancelled = true
    }
  }, [sessionKey, setPendingBySession])

  const current = sessionKey ? pendingBySession[sessionKey] : undefined
  useEffect(() => {
    if (!sessionKey || current === undefined) {
      return
    }
    const timer = setTimeout(() => {
      void writeNativeChatPendingEchoes(sessionKey, current)
    }, PENDING_WRITE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [current, sessionKey])
}
