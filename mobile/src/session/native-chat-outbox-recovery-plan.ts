import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { NativeChatOutboxEntry } from '../storage/native-chat-outbox'
import { findBeaconConfirmedSends, type BeaconPromptReceipt } from './mobile-native-chat-beacon-confirm'
import { findLandedUnconfirmedSends, type UnconfirmedSend } from './mobile-native-chat-draft-reconcile'

/** An entry older than this goes back into the composer instead of out: the host refuses an
 *  operation id this old as new (AGENT_SESSION_MAX_NEW_OPERATION_AGE_MS), and a message a day
 *  late is no longer the message the user meant to send then. */
export const OUTBOX_MAX_RESEND_AGE_MS = 24 * 60 * 60 * 1000
/** How long a terminal resend waits, with the link up, for the agent to be safe to type into. */
export const OUTBOX_SAFE_WAIT_MS = 10 * 60 * 1000
/** The agent must have been safe to type into this long, unbroken, before a resend types:
 *  a queued message the agent takes as its turn ends draws its row in that moment. */
export const OUTBOX_IDLE_SETTLE_MS = 2_000
/** Automatic sends a structured entry gets. Each carries the entry's one operation id, so a
 *  second one can only replay the first's answer, never post the message twice. */
export const OUTBOX_SESSION_AUTO_ATTEMPTS = 2

export type OutboxLane = 'terminal' | 'session'

/** Whether the transcript shows the entry: its row after its boundary, or the agent's own
 *  prompt receipt after it left. `unsure` when its boundary is not in what was read. */
export type OutboxLanding = 'landed' | 'missing' | 'unsure'

export function outboxEntryLanding(
  entry: NativeChatOutboxEntry,
  messages: readonly NativeChatMessage[],
  receipts: readonly BeaconPromptReceipt[]
): OutboxLanding {
  const held: UnconfirmedSend = {
    draftKey: entry.draftKey,
    pendingKey: entry.pendingKey,
    text: entry.text,
    normalizedText: entry.normalizedText,
    baselineTailMessageId: entry.baselineTailMessageId,
    deadline: null,
    ...(entry.knownReceiptNonces ? { knownReceiptNonces: new Set(entry.knownReceiptNonces) } : {})
  }
  // A mid-turn prompt Claude Code takes from its queue writes no row (isTakenSend); its own
  // hook still reports it. Without this a delivered mid-turn message would read as missing.
  if (findBeaconConfirmedSends(receipts, [held]).length > 0) {
    return 'landed'
  }
  if (!entry.baselineResolved) {
    return 'unsure'
  }
  if (findLandedUnconfirmedSends(messages, [held]).length > 0) {
    return 'landed'
  }
  return entry.baselineTailMessageId !== null &&
    !messages.some((message) => message.id === entry.baselineTailMessageId)
    ? 'unsure'
    : 'missing'
}

/** Why an entry goes back into the composer, in the notice's words. */
export const OUTBOX_GIVE_BACK = {
  attachments: 'the app closed before it reached your desktop. Attach the files again and send it',
  tooOld: 'the app closed before it reached your desktop, more than a day ago. Send it again',
  busy: 'the agent on your desktop stayed busy for 10 minutes after the app came back. Send it again',
  session: 'the session on this tab changed before it reached your desktop. Send it again'
} as const

export type OutboxGiveBack = keyof typeof OUTBOX_GIVE_BACK

export type OutboxStep =
  | { kind: 'wait' }
  | { kind: 'retire' }
  | { kind: 'give-back'; reason: OutboxGiveBack }
  | { kind: 'fail' }
  | { kind: 'send' }

/**
 * What the recovery does with one entry now. Pure: the hook supplies what it knows.
 *
 * - The tab's session changed: the words go back (they were meant for the old one).
 * - Not until the transcript is this session's settled read can anything be told.
 * - Landed (its row, or the agent's receipt): retired, nothing sent.
 * - Over a day old, or carrying files: back into the composer.
 * - A terminal entry a previous automatic send already went out for, or one whose boundary
 *   the read no longer reaches, is never typed again by itself: there is no server id to
 *   dedupe on, so it says "Not sent" and waits for Retry. A structured one is resent under
 *   its own operation id, up to OUTBOX_SESSION_AUTO_ATTEMPTS times.
 * - Otherwise it goes when it is safe: the link up, and for a terminal the agent safe to type
 *   into for OUTBOX_IDLE_SETTLE_MS; a terminal that waits OUTBOX_SAFE_WAIT_MS gives it back.
 */
export function planOutboxEntry(input: {
  entry: NativeChatOutboxEntry
  lane: OutboxLane
  pendingKey: string | null
  transcriptSettled: boolean
  landing: OutboxLanding
  now: number
  sendable: boolean
  /** How long the agent has been safe to type into, unbroken; null when it is not. */
  idleForMs: number | null
  /** Link-up time this entry has waited for a safe moment so far. */
  waitedMs: number
  /** The user tapped Retry on its bubble. */
  userRetry: boolean
}): OutboxStep {
  const { entry, lane, landing, now, userRetry } = input
  if (entry.pendingKey !== null && input.pendingKey !== null && entry.pendingKey !== input.pendingKey) {
    return { kind: 'give-back', reason: 'session' }
  }
  if (!input.transcriptSettled) {
    return { kind: 'wait' }
  }
  if (landing === 'landed') {
    return { kind: 'retire' }
  }
  if (now - entry.createdAt > OUTBOX_MAX_RESEND_AGE_MS) {
    return { kind: 'give-back', reason: 'tooOld' }
  }
  if (entry.hasAttachments) {
    return { kind: 'give-back', reason: 'attachments' }
  }
  if (!userRetry) {
    if (entry.failed) {
      return { kind: 'wait' }
    }
    const spent =
      lane === 'terminal'
        ? entry.autoAttempts >= 1 || landing === 'unsure'
        : entry.autoAttempts >= OUTBOX_SESSION_AUTO_ATTEMPTS
    if (spent) {
      return { kind: 'fail' }
    }
  }
  const safe =
    input.sendable && (lane === 'session' || (input.idleForMs !== null && input.idleForMs >= OUTBOX_IDLE_SETTLE_MS))
  if (safe) {
    return { kind: 'send' }
  }
  if (!userRetry && lane === 'terminal' && input.waitedMs >= OUTBOX_SAFE_WAIT_MS) {
    return { kind: 'give-back', reason: 'busy' }
  }
  return { kind: 'wait' }
}
