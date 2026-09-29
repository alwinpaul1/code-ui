import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { useDebouncedPersist } from './use-debounced-persist'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  rememberEchoInPending,
  rememberHeldWitnesses,
  sweepWitnessedEchoes,
  withoutWitnessesOfSends,
  type HeldWitness
} from './mobile-native-chat-remember-echo'
import {
  readNativeChatPendingEchoes,
  writeNativeChatPendingEchoes
} from '../storage/native-chat-pending-echoes'
import {
  takeMobileNativeChatPending,
  type MobileNativeChatPendingMessage
} from './mobile-native-chat-pending-echo'
import { rememberWaitingPhotoSends, withThisRunsPhotos } from './mobile-native-chat-waiting-photo-sends'

const PENDING_WRITE_DEBOUNCE_MS = 250

/** Witnesses a chat held for a session and went away before that session's
 *  stored echoes came back: the next chat of the session takes them at its own
 *  read-back. The write to the store after a second read (below) is for a
 *  relaunch; this is for a chat that came straight back, whose read was issued
 *  before that write and would miss it (review, 2026-09-25). */
const handedOn = new Map<string, HeldWitness[]>()

/** Test-only: the map outlives a single test's hooks. */
export function resetHandedOnWitnessesForTests(): void {
  handedOn.clear()
}

/** The write, and the photo sends in it kept for a chat that comes back
 *  before its read does (mobile-native-chat-waiting-photo-sends.ts). */
function writePendingAndRemember(sessionKey: string, pending: MobileNativeChatPendingMessage[]): Promise<void> {
  rememberWaitingPhotoSends(sessionKey, pending)
  return writeNativeChatPendingEchoes(sessionKey, pending)
}

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
): {
  rememberEcho: (id: string, text: string, anchorId: string | null, queued?: boolean) => void
  /** Mark own sends the agent took out of its queue box (isTakenSend). */
  takeSends: (ids: readonly string[]) => void
} {
  const sessionKeyRef = useRef(sessionKey)
  sessionKeyRef.current = sessionKey
  const memoryRef = useRef(memory)
  memoryRef.current = memory
  /** The session whose stored echoes have been read back. A witness seen
   *  before then is held, not stored: the phone's own sends are not in the
   *  store yet, so the hook's copy of one looks like someone else's message
   *  (rememberHeldWitnesses says what becomes of it). */
  const hydratedRef = useRef<string | null>(null)
  const heldRef = useRef(new Map<string, HeldWitness[]>())
  const rememberEcho = useCallback(
    (id: string, text: string, anchorId: string | null, queued = false) => {
      const key = sessionKeyRef.current
      const draftKey = memoryRef.current?.draftKey
      const messages = memoryRef.current?.messagesRef.current
      if (!key || !draftKey || !anchorId || !messages) {
        return
      }
      if (hydratedRef.current !== key) {
        const held = heldRef.current.get(key) ?? []
        if (!held.some((witness) => witness.id === id)) {
          heldRef.current.set(key, [...held, { id, text, anchorId, messages, draftKey, at: Date.now(), ...(queued ? { queued } : {}) }])
        }
        return
      }
      setPendingBySession((previous) =>
        rememberEchoInPending(previous, key, id, text, anchorId, messages, draftKey, Date.now(), queued)
      )
    },
    [setPendingBySession]
  )
  const takeSends = useCallback(
    (ids: readonly string[]) => {
      const key = sessionKeyRef.current
      if (key) {
        setPendingBySession((previous) => takeMobileNativeChatPending(previous, key, ids))
      }
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
    void readNativeChatPendingEchoes(sessionKey).then((read) => {
      // Storage leaves `data:` photos out; this run still has them.
      const stored = read && withThisRunsPhotos(sessionKey, read)
      const held = [...(handedOn.get(sessionKey) ?? []), ...(heldRef.current.get(sessionKey) ?? [])]
      handedOn.delete(sessionKey)
      heldRef.current.delete(sessionKey)
      if (cancelled) {
        // Gone before the read came back: keep what the chat saw rather than
        // lose it (review, 2026-09-25). Read again, behind any write the
        // unmount flushed, so that write is not undone.
        if (held.length > 0) {
          handedOn.set(sessionKey, held)
          void readNativeChatPendingEchoes(sessionKey).then((fresh) => {
            // Against what is there now: a chat that came straight back may
            // already have stored the handed-on copy (review, 2026-09-25).
            const onDisk = fresh ?? []
            const list = rememberHeldWitnesses({ [sessionKey]: onDisk }, sessionKey, held, onDisk)[sessionKey] ?? []
            if (list.length > onDisk.length) {
              void writeNativeChatPendingEchoes(sessionKey, list)
            }
          })
        }
        return
      }
      hydratedRef.current = sessionKey
      // Sends made meanwhile come after the stored ones, in send order.
      setPendingBySession((previous) => {
        const live = previous[sessionKey] ?? []
        const liveIds = new Set(live.map((item) => item.id))
        // A send acknowledged while another tab was on screen dropped its
        // witness in memory, not on disk (withoutWitnessesOfSends).
        const merged =
          !stored || stored.length === 0 || previous[sessionKey]?.length === 0
            ? previous
            : {
                ...previous,
                [sessionKey]: [
                  ...withoutWitnessesOfSends(sweepWitnessedEchoes(stored), live)
                    .filter((item) => !liveIds.has(item.id))
                    .map((item) => ({ ...item, restored: true })),
                  ...live
                ]
              }
        return held.length === 0 ? merged : rememberHeldWitnesses(merged, sessionKey, held, stored ?? [])
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
    writePendingAndRemember
  )
  return { rememberEcho, takeSends }
}
