import { useEffect, useMemo, useRef, useState } from 'react'
import { projectMobileChatQueue, type MobileChatQueueEntry } from './mobile-terminal-queued-messages'

/**
 * How long a send made mid-turn waits in the queue box for the agent's own
 * box to list it before it is taken to have been absorbed unseen.
 *
 * The screen is read once a second, each read given 2.5 s
 * (use-mobile-terminal-hud-observation.ts), and the agent paints its queue at
 * the Enter, before the write is even acknowledged, so a message still queued
 * is listed by the first read that completes after the send lands. Past this
 * the only reason the box never showed it is that the agent took it between
 * two reads.
 */
export const QUEUE_SIGHTING_GRACE_MS = 5000

type OwnSend = { id: string; text: string; images?: string[]; sentAt?: number }

const NO_IDS: ReadonlySet<string> = new Set()

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
 * the box decides, exactly as before), the agent stops working, or
 * QUEUE_SIGHTING_GRACE_MS passes with no read listing it: a send the agent
 * absorbed before any read saw the box must not be stranded there. A send
 * made while the agent was idle starts a turn rather than queueing, so it is a
 * bubble at once; so is one with no send time (restored from an older build).
 */
export function useQueuedOwnSends<T extends OwnSend>(
  pending: readonly T[],
  queue: readonly string[] | undefined,
  agentWorking: boolean
): {
  /** Own sends drawn as bubbles in the chat. */
  pending: T[]
  queue: MobileChatQueueEntry[]
  /** Own sends drawn in the queue box before the agent's box listed them. */
  unlisted: T[]
} {
  /** When the phone saw the current working stretch begin, by its clock; null
   *  while idle, and until the first commit that saw it working. A send made
   *  before it was made while the agent was idle, or before this chat was
   *  watching, and is not taken to be queued. */
  const workingSince = useRef<number | null>(null)
  useEffect(() => {
    workingSince.current = agentWorking ? Date.now() : null
  }, [agentWorking])
  /** Sends the agent's box has listed at least once: the box decides them. */
  const listed = useRef(new Set<string>())
  /** Sends whose grace ran out with no box listing them. */
  const [expired, setExpired] = useState(NO_IDS)
  const result = useMemo(() => {
    const projected = projectMobileChatQueue(pending, queue ?? [])
    const outside = new Set(projected.pending.map((item) => item.id))
    for (const item of pending) {
      if (!outside.has(item.id)) {
        listed.current.add(item.id)
      }
    }
    const since = agentWorking ? workingSince.current : null
    const unlisted = projected.pending.filter(
      (item) =>
        since !== null &&
        typeof item.sentAt === 'number' &&
        Number.isFinite(item.sentAt) &&
        item.sentAt >= since &&
        !listed.current.has(item.id) &&
        !expired.has(item.id)
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
  }, [agentWorking, expired, pending, queue])
  // Each unlisted send's grace runs from when the phone first held it, which
  // for a text send is its ack. A timer ends it, so it leaves the queue box
  // without waiting for some other change to re-render the chat.
  const firstSeen = useRef(new Map<string, number>())
  // Bounded by the sends still pending: a retired send is forgotten.
  useEffect(() => {
    const live = new Set(pending.map((item) => item.id))
    for (const id of listed.current) {
      if (!live.has(id)) {
        listed.current.delete(id)
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
  useEffect(() => {
    if (result.unlisted.length === 0) {
      return
    }
    const now = Date.now()
    for (const item of result.unlisted) {
      if (!firstSeen.current.has(item.id)) {
        firstSeen.current.set(item.id, now)
      }
    }
    const deadlineOf = (item: T) => (firstSeen.current.get(item.id) ?? now) + QUEUE_SIGHTING_GRACE_MS
    const next = Math.min(...result.unlisted.map(deadlineOf))
    const timer = setTimeout(() => {
      // The earliest is due by construction; the clock is read again only for
      // any others that fell due in the same moment.
      const at = Math.max(Date.now(), next)
      const due = result.unlisted.filter((item) => deadlineOf(item) <= at).map((item) => item.id)
      setExpired((previous) => new Set([...previous, ...due]))
    }, Math.max(0, next - now))
    return () => clearTimeout(timer)
  }, [result.unlisted])
  return useMemo(
    () => ({ pending: result.pending, queue: result.queue, unlisted: result.unlisted }),
    [result]
  )
}
