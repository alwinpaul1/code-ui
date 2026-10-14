import type {
  NativeChatOutboxEntry,
  NativeChatOutboxFailReason
} from '../storage/native-chat-outbox'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import { OUTBOX_MAX_RESEND_AGE_MS, OUTBOX_TERMINAL_CONFIRM_WAIT_MS } from './native-chat-outbox-recovery-plan'

export { OUTBOX_TERMINAL_CONFIRM_WAIT_MS }

/** How a drainer send ended. 'not-now' is a refusal before anything went out (a session that
 *  could not be held, a terminal busy with another input, words typed at the desk): it costs the
 *  entry no attempt. */
export type OutboxSendOutcome = MobileNativeChatSendOutcome | 'not-now'
/** A tab missing from the tab list is only gone once it has stayed missing this long: a desktop
 *  Orca that just restarted lists no tabs until it restores them. */
export const OUTBOX_TAB_GONE_CONFIRM_MS = 2 * 60_000
/** With no link to the host, the drainer looks again this often: a link the background watcher
 *  opens moves no connection metric the root watches. */
export const OUTBOX_DRAIN_NO_LINK_RECHECK_MS = 30_000

/**
 * What the app-wide outbox drainer (native-chat-outbox-drainer.ts) does with one entry. Pure: the
 * drainer supplies what it looked up.
 *
 * Why it exists: until 0.9.128 a message the phone could not confirm waited in the outbox for its
 * chat to be shown again, and only that chat's recovery sent it. A text whose hold ran out while
 * another chat was on screen went out when the user came back, and a photo said "Delivery
 * unconfirmed" and was given up on. The user: "All messages must be send reliability and must
 * not drop" (2026-10-11). The drainer sends every chat's entries as soon as the link is up, from
 * the root of the app.
 */

/** Waits between automatic tries of one entry, by how many tries in a row came to nothing; the
 *  last one repeats. A new connection or the app coming to the front starts it over. */
export const OUTBOX_DRAIN_BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const
/** Automatic sends a structured entry gets from the drainer. Every one carries the entry's one
 *  operation id, so the host's ledger answers a repeat with the first one's result and none can
 *  post the message twice; the cap is only so a session that keeps refusing ends in "Not sent". */
export const OUTBOX_DRAIN_SESSION_ATTEMPTS = 8
/** Automatic sends a terminal entry gets. Each one types it again, so each needs the evidence
 *  first: no row of it, no prompt receipt, no queue entry, the agent not working, and the confirm
 *  wait over since the last one. */
export const OUTBOX_DRAIN_TERMINAL_ATTEMPTS = 3

/** What the drainer found out about an entry before sending it. */
export type OutboxDrainObservation =
  /** Its row, its prompt receipt or its queue entry is there: it arrived. */
  | { kind: 'landed' }
  /** The tab it was written in is no longer on the desktop. */
  | { kind: 'tab-gone' }
  /** The tab now runs another session than the one it was written for. */
  | { kind: 'session-changed' }
  /** Whether it landed cannot be told (its boundary is not in the read): never typed again. */
  | { kind: 'unsure' }
  /** Not safe to type into now (working, a dialog up, text in the desk's input, an unreadable
   *  queue box, a transcript that would not read): looked at again later. */
  | { kind: 'busy' }
  /** It did not arrive and it is safe to send now; `terminal` is the tab's handle today. */
  | { kind: 'clear'; terminal?: string }

export type OutboxDrainStep =
  | { kind: 'retire' }
  | { kind: 'wait' }
  | { kind: 'send' }
  | { kind: 'fail'; reason: NativeChatOutboxFailReason }

/** Whether the entry is too old to send by itself (the host refuses an operation id this old as
 *  new, and a day-late message is not what the user meant to send then). */
export function outboxEntryTooOld(entry: NativeChatOutboxEntry, now: number): boolean {
  return now - entry.createdAt > OUTBOX_MAX_RESEND_AGE_MS
}

export function planOutboxDrain(
  entry: NativeChatOutboxEntry,
  observation: OutboxDrainObservation,
  now: number
): OutboxDrainStep {
  if (observation.kind === 'landed') {
    return { kind: 'retire' }
  }
  if (outboxEntryTooOld(entry, now)) {
    return { kind: 'fail', reason: 'tooOld' }
  }
  switch (observation.kind) {
    case 'tab-gone':
      return { kind: 'fail', reason: 'tabClosed' }
    case 'session-changed':
      return { kind: 'fail', reason: 'session' }
    case 'unsure':
      return { kind: 'fail', reason: 'unsure' }
    case 'busy':
      return { kind: 'wait' }
    case 'clear': {
      const cap =
        entry.route?.lane === 'terminal' ? OUTBOX_DRAIN_TERMINAL_ATTEMPTS : OUTBOX_DRAIN_SESSION_ATTEMPTS
      return entry.autoAttempts >= cap ? { kind: 'fail', reason: 'attempts' } : { kind: 'send' }
    }
    default: {
      const unhandled: never = observation
      return unhandled
    }
  }
}

/** The wait after `failures` tries in a row came to nothing. */
export function outboxDrainBackoffMs(failures: number): number {
  const index = Math.min(Math.max(failures, 1), OUTBOX_DRAIN_BACKOFF_MS.length) - 1
  return OUTBOX_DRAIN_BACKOFF_MS[index]!
}

/** When a terminal entry may next be looked at, given its last send.
 *
 *  An entry handed to the outbox before anything was typed (`unwritten`, and no automatic send of it
 *  started yet: a send parked offline, a reply typed into a notification) has no send in flight and
 *  nothing that could still land, which is what outboxEntryLanding already says of it, so there is
 *  nothing to wait for: it is due as soon as it is written. */
export function outboxTerminalConfirmedAt(entry: NativeChatOutboxEntry): number {
  if (entry.unwritten && entry.lastAttemptAt === undefined) {
    return entry.createdAt
  }
  return (entry.lastAttemptAt ?? entry.createdAt) + OUTBOX_TERMINAL_CONFIRM_WAIT_MS
}

/**
 * The entries the drainer may take now, oldest first. Messages of one chat go in the order they
 * were sent: the oldest entry of a chat that is still on its way holds the ones after it, whoever
 * carries it. A failed entry waits for the user's Retry and holds nothing back. An entry the
 * drainer cannot send (written by an older build) holds nothing back either: it waits for its
 * chat's recovery.
 */
export function outboxDrainCandidates(
  entries: readonly NativeChatOutboxEntry[],
  can: {
    /** A send in this process carries it now. */
    live: (entry: NativeChatOutboxEntry) => boolean
    /** The drainer can send it at all (outboxEntryDrainable). */
    drainable: (entry: NativeChatOutboxEntry) => boolean
    /** Its chat's recovery, on screen with a settled transcript, sees it through instead. */
    ownedByChat: (entry: NativeChatOutboxEntry) => boolean
  }
): NativeChatOutboxEntry[] {
  const byChat = new Map<string, NativeChatOutboxEntry[]>()
  for (const entry of [...entries].sort((left, right) => left.createdAt - right.createdAt)) {
    const list = byChat.get(entry.draftKey)
    if (list) {
      list.push(entry)
    } else {
      byChat.set(entry.draftKey, [entry])
    }
  }
  const picked: NativeChatOutboxEntry[] = []
  for (const list of byChat.values()) {
    for (const entry of list) {
      if (entry.failed || !can.drainable(entry)) {
        continue
      }
      if (!can.live(entry) && !can.ownedByChat(entry)) {
        picked.push(entry)
      }
      break
    }
  }
  return picked.sort((left, right) => left.createdAt - right.createdAt)
}
