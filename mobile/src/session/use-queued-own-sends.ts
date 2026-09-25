import { useEffect, useMemo, useRef, useState } from 'react'
import { projectMobileChatQueue, type MobileChatQueueEntry } from './mobile-terminal-queued-messages'
import { isTakenSend } from './mobile-native-chat-pending-echo'
import { normalizeReconcileText } from './mobile-native-chat-draft-reconcile'

const ownKey = (text: string) => normalizeReconcileText(text)

/**
 * How long a send made mid-turn stays in the queue box, unlisted by the
 * agent's own box, before the screen reads may say it was absorbed unseen.
 *
 * The screen is read once a second, each read given 2.5 s
 * (use-mobile-terminal-hud-observation.ts), and the agent paints its queue at
 * the Enter, before the write is even acknowledged, so a message still queued
 * is listed by the first read that completes after the send lands.
 */
export const QUEUE_SIGHTING_GRACE_MS = 5000
/** Completed screen reads after the send, none listing it, that it takes to
 *  call it absorbed. Two, because the first may have been asked for before the
 *  Enter reached the agent. */
export const QUEUE_SIGHTING_READS = 2
/** The longest a send waits for any of that, reads or no reads. A link whose
 *  reads all time out says nothing either way, and the send must not be
 *  stranded in the box. */
export const QUEUE_SIGHTING_CAP_MS = 15_000
/** Box rows remembered with when they were first read, so a send whose ack
 *  came after the box listed it and let it go is known as listed. */
const SEEN_ROWS_CAP = 32

type OwnSend = { id: string; text: string; images?: string[]; sentAt?: number; takenAt?: number }

/** The agents whose queue box the phone parses off the screen, as
 *  use-mobile-terminal-hud-observation.ts reads them. Keep the two in step. */
export function agentHasQueueReader(agent: string | null | undefined): boolean {
  return agent === 'claude' || agent === 'openclaude' || agent === 'codex'
}

const NO_IDS: ReadonlySet<string> = new Set()

export type QueuedOwnSendsScope = {
  /** The session on screen. A send is queued only if this chat saw the agent
   *  working in THIS session before it was sent, so coming back to a tab
   *  never puts a send the agent already took back in the box. */
  scopeKey: string
  /** Whether the phone reads this agent's queue box at all: Claude and Codex
   *  on the terminal lane. Without it nothing would ever list the send, and
   *  every mid-turn send would sit in the box for the whole wait. */
  readsQueueBox: boolean
  /** Something that changes with each completed screen read while the agent
   *  works: Claude's spinner, whose elapsed time moves every second. Absent
   *  (Codex, or no spinner on screen), only the cap ends the wait. */
  readBeat: unknown
  /** Told the ids of own sends the agent has taken out of its queue box: the
   *  box listed one and let it go, or the reads say it went unseen. Claude
   *  Code writes no row for a prompt it takes mid-turn (isTakenSend), so the
   *  store stops counting them as sends still waiting for one. */
  onTaken?: (ids: readonly string[]) => void
}

/**
 * The phone's own sends split between the queue box and the chat, as
 * projectMobileChatQueue does, with one more rule: a send made while the agent
 * was already working is QUEUED from the moment it exists, not from the moment
 * the once-a-second screen read first finds it in the agent's queue box.
 *
 * Before this the send drew as a bubble in the chat, jumped into the queue box
 * on the next read, and back out as a bubble once the agent took it —
 * "When I queue a message it goes out of queue and gets suddenly queued"
 * (2026-09-25). The composer said "Queue a message…" at the tap; the queue box
 * is where it belongs.
 *
 * It stays there, unlisted, only until the agent's box lists it (after which
 * the box decides, exactly as before), the agent stops working, or the reads
 * say it is gone: QUEUE_SIGHTING_GRACE_MS passed and QUEUE_SIGHTING_READS
 * reads completed without listing it, or QUEUE_SIGHTING_CAP_MS passed. A send
 * the agent absorbed before any read saw the box is not stranded there. A send
 * made while the agent was idle starts a turn rather than queueing, so it is a
 * bubble at once; so is one with no send time (restored from an older build).
 */
export function useQueuedOwnSends<T extends OwnSend>(
  pending: readonly T[],
  queue: readonly string[] | undefined,
  agentWorking: boolean,
  { scopeKey, readsQueueBox, readBeat, onTaken }: QueuedOwnSendsScope
): {
  /** Own sends drawn as bubbles in the chat. */
  pending: T[]
  queue: MobileChatQueueEntry[]
  /** Own sends drawn in the queue box before the agent's box listed them. */
  unlisted: T[]
} {
  /** When the phone saw the current working stretch begin, by its clock; null
   *  while idle. It starts again on every change of session. A send older
   *  than it was made while the agent was idle, or before this chat was
   *  watching this session, so coming back to a tab never puts a send the
   *  agent already took back in the box (second review, 2026-09-25). */
  const workingSince = useRef<number | null>(null)
  useEffect(() => {
    workingSince.current = agentWorking ? Date.now() : null
  }, [agentWorking, scopeKey])
  /** Each box row read, with when it was first read. */
  const seenRows = useRef(new Map<string, number>())
  useEffect(() => {
    const now = Date.now()
    for (const row of queue ?? []) {
      if (!seenRows.current.has(row)) {
        seenRows.current.set(row, now)
      }
    }
    for (const row of seenRows.current.keys()) {
      if (seenRows.current.size <= SEEN_ROWS_CAP) {
        break
      }
      seenRows.current.delete(row)
    }
  }, [queue])
  /** Sends the agent's box has listed at least once: the box decides them. */
  const listed = useRef(new Set<string>())
  /** Sends the reads say were absorbed without the box ever listing them. */
  const [expired, setExpired] = useState(NO_IDS)
  const result = useMemo(() => {
    // A send the agent took is not the box's row while a copy of its text
    // still waits: the row is that copy's. Handed to the taken one, the copy
    // stayed unlisted and the taken one looked let go again at the end of the
    // turn, onto the copy's dequeued row (review, 2026-09-25).
    const waiting = new Set(pending.filter((item) => !isTakenSend(item)).map((item) => ownKey(item.text)))
    const shadowed = new Set(
      pending.filter((item) => isTakenSend(item) && waiting.has(ownKey(item.text))).map((item) => item.id)
    )
    const boxed = projectMobileChatQueue(
      shadowed.size === 0 ? pending : pending.filter((item) => !shadowed.has(item.id)),
      queue ?? []
    )
    const projected =
      shadowed.size === 0
        ? boxed
        : {
            ...boxed,
            pending: pending.filter((item) => shadowed.has(item.id) || boxed.pending.includes(item))
          }
    const outside = new Set(projected.pending.map((item) => item.id))
    for (const item of pending) {
      if (!outside.has(item.id)) {
        listed.current.add(item.id)
      }
    }
    const since = agentWorking && readsQueueBox ? workingSince.current : null
    const unlisted = projected.pending.filter(
      (item) =>
        since !== null &&
        typeof item.sentAt === 'number' &&
        Number.isFinite(item.sentAt) &&
        item.sentAt >= since &&
        !listed.current.has(item.id) &&
        !expired.has(item.id) &&
        !listedBeforeItExisted(item, seenRows.current, listed.current)
    )
    if (unlisted.length === 0) {
      return { ...projected, unlisted }
    }
    const held = new Set(unlisted)
    return {
      pending: projected.pending.filter((item) => !held.has(item)),
      // Last, in send order: the agent appends a new message to its queue.
      queue: [
        ...projected.queue,
        ...unlisted.map((item) => ({
          text: item.text,
          images: item.images ?? [],
          caption: item.text,
          unlisted: true as const
        }))
      ],
      unlisted
    }
  }, [agentWorking, expired, pending, queue, readsQueueBox])
  // Out of the box after being in it: the agent has it. Each release is told
  // once, and a taken send that is back in the box and out again is told again:
  // a relay drop hands the chat no queue, so a send still queued looks let go,
  // and only its last release says when Claude dequeued it (review,
  // 2026-09-25). Only the phone's own sends are marked
  // (takeMobileNativeChatPending).
  const inBox = useRef(new Set<string>())
  const told = useRef(new Set<string>())
  useEffect(() => {
    const outside = new Set(result.pending.map((item) => item.id))
    const released: string[] = []
    for (const item of pending) {
      if (!outside.has(item.id)) {
        inBox.current.add(item.id)
        told.current.delete(item.id)
        continue
      }
      const wasInBox = inBox.current.delete(item.id)
      const wentThrough = wasInBox || listed.current.has(item.id) || expired.has(item.id)
      if (wentThrough && !told.current.has(item.id) && (wasInBox || !isTakenSend(item))) {
        told.current.add(item.id)
        released.push(item.id)
      }
    }
    if (released.length > 0) {
      onTaken?.(released)
    }
  }, [expired, onTaken, pending, result.pending])
  // Bounded by the sends still pending: a retired send is forgotten.
  const firstSeen = useRef(new Map<string, { at: number; beats: number }>())
  useEffect(() => {
    const live = new Set(pending.map((item) => item.id))
    for (const ids of [listed.current, inBox.current, told.current]) {
      for (const id of ids) {
        if (!live.has(id)) {
          ids.delete(id)
        }
      }
    }
    for (const id of firstSeen.current.keys()) {
      if (!live.has(id)) {
        firstSeen.current.delete(id)
      }
    }
    setExpired((previous) => {
      const kept = [...previous].filter((id) => live.has(id))
      return kept.length === previous.size ? previous : new Set(kept)
    })
  }, [pending])
  // Completed reads, counted by what they parsed rather than by object, so
  // two reads of the same second count once.
  const beats = useRef({ count: 0, last: '' })
  const beat = readBeat == null ? '' : JSON.stringify(readBeat)
  const [beatCount, setBeatCount] = useState(0)
  useEffect(() => {
    if (beat !== '' && beat !== beats.current.last) {
      beats.current = { count: beats.current.count + 1, last: beat }
      setBeatCount(beats.current.count)
    }
  }, [beat])
  // Each unlisted send's wait runs from when the phone first held it, which
  // for a text send is its ack. Timers end it, so it leaves the queue box
  // without waiting for some other change to re-render the chat.
  useEffect(() => {
    if (result.unlisted.length === 0) {
      return
    }
    const now = Date.now()
    for (const item of result.unlisted) {
      if (!firstSeen.current.has(item.id)) {
        firstSeen.current.set(item.id, { at: now, beats: beats.current.count })
      }
    }
    const due = (at: number) =>
      result.unlisted
        .filter((item) => {
          const seen = firstSeen.current.get(item.id)
          if (!seen) {
            return false
          }
          const waited = at - seen.at
          return (
            waited >= QUEUE_SIGHTING_CAP_MS ||
            (waited >= QUEUE_SIGHTING_GRACE_MS && beats.current.count - seen.beats >= QUEUE_SIGHTING_READS)
          )
        })
        .map((item) => item.id)
    const expire = (ids: string[]) => {
      if (ids.length > 0) {
        setExpired((previous) => new Set([...previous, ...ids]))
      }
    }
    expire(due(now))
    const timers = result.unlisted.flatMap((item) => {
      const seen = firstSeen.current.get(item.id)!
      return [QUEUE_SIGHTING_GRACE_MS, QUEUE_SIGHTING_CAP_MS].map((after) =>
        setTimeout(() => expire(due(Math.max(Date.now(), seen.at + after))), Math.max(0, seen.at + after - now))
      )
    })
    return () => {
      for (const timer of timers) {
        clearTimeout(timer)
      }
    }
  }, [beatCount, result.unlisted])
  return useMemo(
    () => ({ pending: result.pending, queue: result.queue, unlisted: result.unlisted }),
    [result]
  )
}

/** Whether the box listed a row that is this send after it left the phone,
 *  before the phone held it: an ack that came after the agent had queued and
 *  taken the message. Such a send is a bubble at once. */
function listedBeforeItExisted(
  item: OwnSend,
  seenRows: ReadonlyMap<string, number>,
  listed: Set<string>
): boolean {
  if (typeof item.sentAt !== 'number') {
    return false
  }
  for (const [row, seenAt] of seenRows) {
    if (seenAt >= item.sentAt && projectMobileChatQueue([item], [row]).pending.length === 0) {
      listed.add(item.id)
      return true
    }
  }
  return false
}
