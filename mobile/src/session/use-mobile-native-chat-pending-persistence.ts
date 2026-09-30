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
  readNativeChatPendingEchoRecord,
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
 * The session's stored echoes ahead of the live ones, marked restored: sends
 * made meanwhile come after the stored ones, in send order. A send
 * acknowledged while another tab was on screen dropped its witness in memory,
 * not on disk (withoutWitnessesOfSends).
 *
 * `afterRefusal`: read only after the first read of the session was refused.
 * The list this visit emptied is then no sign the stored echoes were retired,
 * since this visit never had them, so they are merged all the same; and a
 * witness this visit stored of a send it could not read yet gives way to that
 * send, as rememberHeldWitnesses has it for one held while the read was out.
 */
function withStoredEchoes(
  previous: PendingBySession,
  key: string,
  stored: MobileNativeChatPendingMessage[] | null,
  afterRefusal = false
): PendingBySession {
  if (!stored || stored.length === 0 || (!afterRefusal && previous[key]?.length === 0)) {
    return previous
  }
  const live = afterRefusal ? withoutWitnessesOfSends(previous[key] ?? [], stored) : (previous[key] ?? [])
  const liveIds = new Set(live.map((item) => item.id))
  return {
    ...previous,
    [key]: [
      ...withoutWitnessesOfSends(sweepWitnessedEchoes(stored), live)
        .filter((item) => !liveIds.has(item.id))
        .map((item) => ({ ...item, restored: true })),
      ...live
    ]
  }
}

const REFUSED_READ_LINE =
  '[storage] could not read the chat pending echoes; nothing is written over them until a read succeeds'
const REFUSED_WRITE_LINE =
  '[storage] could not save the chat pending echoes: the stored ones could not be read, and writing over them would erase them'

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
  rememberEcho: (id: string, text: string, anchorId: string | null) => void
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
  /** Sessions whose stored echoes have not been read: the read is still out,
   *  or storage refused it. Absent once a read came back (writeOverStored). */
  const unreadRef = useRef(new Map<string, 'pending' | 'refused'>())
  /** The last write asked for while a session's read was out. */
  const deferredRef = useRef(new Map<string, MobileNativeChatPendingMessage[]>())
  /** Sessions a skipped write has been logged for, since the last read. */
  const loggedRef = useRef(new Set<string>())
  /**
   * The write, unless the session's stored echoes have not been read. The
   * whole list sits under one key, so a write after a refused read, taken for
   * an empty store, put this visit's list over every echo stored before
   * (2026-09-30). While the read is out the write waits for it. After a
   * refusal the store is read again first: still refused, nothing is written
   * and one line says why; read, the stored echoes are merged into what is
   * written and back into the chat.
   */
  const writeOverStored = useCallback(
    (key: string, list: MobileNativeChatPendingMessage[]) => {
      const unread = unreadRef.current.get(key)
      if (unread === undefined) {
        void writePendingAndRemember(key, list)
        return
      }
      if (unread === 'pending') {
        deferredRef.current.set(key, list)
        return
      }
      void readNativeChatPendingEchoRecord(key).then((read) => {
        if ('refused' in read) {
          if (!loggedRef.current.has(key)) {
            loggedRef.current.add(key)
            console.warn(REFUSED_WRITE_LINE, read.refused)
          }
          return
        }
        unreadRef.current.delete(key)
        loggedRef.current.delete(key)
        const stored = read.pending ? withThisRunsPhotos(key, read.pending) : null
        void writePendingAndRemember(key, withStoredEchoes({ [key]: list }, key, stored, true)[key] ?? list)
        setPendingBySession((previous) => withStoredEchoes(previous, key, stored, true))
      })
    },
    [setPendingBySession]
  )
  const rememberEcho = useCallback(
    (id: string, text: string, anchorId: string | null) => {
      const key = sessionKeyRef.current
      const draftKey = memoryRef.current?.draftKey
      const messages = memoryRef.current?.messagesRef.current
      if (!key || !draftKey || !anchorId || !messages) {
        return
      }
      if (hydratedRef.current !== key) {
        const held = heldRef.current.get(key) ?? []
        if (!held.some((witness) => witness.id === id)) {
          heldRef.current.set(key, [...held, { id, text, anchorId, messages, draftKey, at: Date.now() }])
        }
        return
      }
      setPendingBySession((previous) =>
        rememberEchoInPending(previous, key, id, text, anchorId, messages, draftKey)
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
    // Unread until the read is back: a send made before then waits for it
    // rather than going over a list this chat has not seen.
    unreadRef.current.set(sessionKey, 'pending')
    void readNativeChatPendingEchoRecord(sessionKey).then((read) => {
      const refused = 'refused' in read
      // Storage leaves `data:` photos out; this run still has them.
      const stored = !refused && read.pending ? withThisRunsPhotos(sessionKey, read.pending) : null
      if (refused) {
        console.warn(REFUSED_READ_LINE, read.refused)
        unreadRef.current.set(sessionKey, 'refused')
      } else {
        unreadRef.current.delete(sessionKey)
        loggedRef.current.delete(sessionKey)
      }
      // The write asked for meanwhile, over the stored list as the chat's own
      // list is merged below; after a refusal it reads once more first.
      const waiting = deferredRef.current.get(sessionKey)
      deferredRef.current.delete(sessionKey)
      if (waiting && refused) {
        writeOverStored(sessionKey, waiting)
      } else if (waiting) {
        void writePendingAndRemember(sessionKey, withStoredEchoes({ [sessionKey]: waiting }, sessionKey, stored)[sessionKey] ?? waiting)
      }
      const held = [...(handedOn.get(sessionKey) ?? []), ...(heldRef.current.get(sessionKey) ?? [])]
      handedOn.delete(sessionKey)
      heldRef.current.delete(sessionKey)
      if (cancelled) {
        // Gone before the read came back: keep what the chat saw rather than
        // lose it (review, 2026-09-25). Read again, behind any write the
        // unmount flushed, so that write is not undone.
        if (held.length > 0) {
          handedOn.set(sessionKey, held)
          void readNativeChatPendingEchoRecord(sessionKey).then((fresh) => {
            // A refused read is not an empty store: written over, it would
            // lose every echo stored before. The next chat takes them.
            if ('refused' in fresh) {
              console.warn(REFUSED_WRITE_LINE, fresh.refused)
              return
            }
            // Against what is there now: a chat that came straight back may
            // already have stored the handed-on copy (review, 2026-09-25).
            const onDisk = fresh.pending ?? []
            const list = rememberHeldWitnesses({ [sessionKey]: onDisk }, sessionKey, held, onDisk)[sessionKey] ?? []
            if (list.length > onDisk.length) {
              void writeNativeChatPendingEchoes(sessionKey, list)
            }
          })
        }
        return
      }
      // Read or not, the chat goes on and remembers what it sees; only the
      // writes wait for the store to be read (writeOverStored).
      hydratedRef.current = sessionKey
      setPendingBySession((previous) => {
        const merged = withStoredEchoes(previous, sessionKey, stored)
        return held.length === 0 ? merged : rememberHeldWitnesses(merged, sessionKey, held, stored ?? [])
      })
    })
    return () => {
      cancelled = true
    }
  }, [sessionKey, setPendingBySession, writeOverStored])

  const current = sessionKey ? pendingBySession[sessionKey] : undefined
  // An emptied list is written at once: it retires bubbles the transcript has
  // taken over, and a delay there redraws them for a beat on the next visit.
  useDebouncedPersist(sessionKey, current, current?.length === 0 ? 0 : PENDING_WRITE_DEBOUNCE_MS, writeOverStored)
  return { rememberEcho, takeSends }
}
