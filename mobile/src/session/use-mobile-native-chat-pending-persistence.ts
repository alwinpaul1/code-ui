import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { useDebouncedPersist } from './use-debounced-persist'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { rememberEchoInPending, sweepWitnessedEchoes } from './mobile-native-chat-remember-echo'
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
  setPendingBySession: Dispatch<SetStateAction<PendingBySession>>,
  /** What a witnessed message is remembered against; see `rememberEchoInPending`. */
  memory?: { messagesRef: { current: readonly NativeChatMessage[] }; draftKey: string | null }
): { rememberEcho: (id: string, text: string, anchorId: string | null) => void } {
  const sessionKeyRef = useRef(sessionKey)
  sessionKeyRef.current = sessionKey
  const memoryRef = useRef(memory)
  memoryRef.current = memory
  const rememberEcho = useCallback(
    (id: string, text: string, anchorId: string | null) => {
      const key = sessionKeyRef.current
      const draftKey = memoryRef.current?.draftKey
      const messages = memoryRef.current?.messagesRef.current
      if (!key || !draftKey || !anchorId || !messages) {
        return
      }
      setPendingBySession((previous) =>
        rememberEchoInPending(previous, key, id, text, anchorId, messages, draftKey)
      )
    },
    [setPendingBySession]
  )
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
        if (previous[sessionKey]?.length === 0) {
          return previous
        }
        const live = previous[sessionKey] ?? []
        const liveIds = new Set(live.map((item) => item.id))
        return {
          ...previous,
          [sessionKey]: [
            ...sweepWitnessedEchoes(stored)
              .filter((item) => !liveIds.has(item.id))
              .map((item) => ({ ...item, restored: true })),
            ...live
          ]
        }
      })
    })
    return () => {
      cancelled = true
    }
  }, [sessionKey, setPendingBySession])

  const current = sessionKey ? pendingBySession[sessionKey] : undefined
  // An emptied list is written at once: it retires bubbles the transcript has
  // taken over, and a delay there redraws them for a beat on the next visit.
  useDebouncedPersist(
    sessionKey,
    current,
    current?.length === 0 ? 0 : PENDING_WRITE_DEBOUNCE_MS,
    writeNativeChatPendingEchoes
  )
  return { rememberEcho }
}
