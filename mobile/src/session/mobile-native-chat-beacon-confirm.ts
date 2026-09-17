import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import type { UnconfirmedSend } from './mobile-native-chat-draft-reconcile'

/** One `up=` reading from the agent's own `UserPromptSubmit` hook: the text the
 *  agent says it accepted, and whether the hook truncated it. */
export type BeaconPromptReceipt = {
  /** The hook's pid. Separates two identical prompts; it does NOT name a
   *  sender — a phone send and a desktop submission are the same event to the
   *  agent, both arriving as `source: "user"`. */
  nonce: string
  text: string
  cut?: boolean
}

/**
 * Held sends the agent has confirmed receiving, via its own prompt receipt.
 *
 * Why this is worth having: an ack-lost send otherwise waits
 * `UNCONFIRMED_SEND_DEADLINE_MS` (20 s) for a transcript row before the phone
 * can stop calling it unconfirmed. The hook fires on every submission and its
 * beacon lands in about a second.
 *
 * That gain is narrower than it first looks, and the limit is worth stating: the
 * confirm effect runs when the RECEIPTS change, while a hold is a ref mutation
 * that re-runs nothing. So it only helps when the receipt arrives AFTER the
 * hold, which is the socket-drop path. On the 15 s request-timeout path the
 * receipt has already landed by the time the send is held, nothing re-runs, and
 * the send waits the full 20 s exactly as before. The
 * gain is not identity but FIDELITY: the transcript row it replaces is matched
 * against a screen that wraps, truncates and box-draws, while this is the
 * agent's own bytes.
 *
 * What this deliberately does NOT do is retire the pending bubble. A mid-turn
 * send's only transcript record is the `queued_command` attachment Orca's
 * reader drops, so a bubble retired on a receipt would have no row to be
 * replaced by and would simply vanish — the 2026-09-13 defect. Confirmation
 * stops the clock; the bubble still leaves only when a row claims it.
 *
 * Matching mirrors `findLandedUnconfirmedSends`: entries are considered in send
 * order and each receipt is claimed once, so two identical prompts confirm one
 * send each rather than both confirming the first.
 */
export function findBeaconConfirmedSends(
  receipts: readonly BeaconPromptReceipt[],
  entries: readonly UnconfirmedSend[]
): UnconfirmedSend[] {
  if (receipts.length === 0 || entries.length === 0) {
    return []
  }
  const normalized = receipts.map((receipt) => ({
    nonce: receipt.nonce,
    cut: receipt.cut === true,
    text: normalizeNativeChatUserText(receipt.text)
  }))
  // Keyed by nonce: a beacon repeats the same reading while it is the latest,
  // so the same submission must not confirm two different sends.
  const claimedNonces = new Set<string>()
  const confirmed: UnconfirmedSend[] = []
  for (const entry of entries) {
    // An empty send has no text to match on, and an empty receipt would match
    // everything by prefix. Neither is evidence of anything.
    if (entry.normalizedText === '') {
      continue
    }
    const receipt = normalized.find((candidate) => {
      if (candidate.text === '' || claimedNonces.has(candidate.nonce)) {
        return false
      }
      // Only a receipt the agent reported AFTER this send can be evidence of
      // it. The beacon's history reaches back across launches, so an older
      // identical prompt (typed at the desk, or this phone's own earlier send)
      // would otherwise confirm a message that never arrived.
      if (entry.knownReceiptNonces?.has(candidate.nonce)) {
        return false
      }
      return candidate.cut
        ? entry.normalizedText.startsWith(candidate.text)
        : candidate.text === entry.normalizedText
    })
    if (receipt) {
      claimedNonces.add(receipt.nonce)
      confirmed.push(entry)
    }
  }
  return confirmed
}
