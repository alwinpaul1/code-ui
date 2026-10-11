import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import type { UnconfirmedSend } from './mobile-native-chat-draft-reconcile'
import { claimNonceForSend, nonceClaimedByAnother } from '../storage/native-chat-send-claims'
import type { DesktopPrompt } from './agent-hud-beacon'

/** One `up=` reading from the agent's own `UserPromptSubmit` hook: the text the
 *  agent says it accepted, and whether the hook truncated it. */
export type BeaconPromptReceipt = {
  /** The hook's pid. Separates two identical prompts; it does NOT name a
   *  sender — a phone send and a desktop submission are the same event to the
   *  agent, both arriving as `source: "user"`. */
  nonce: string
  text: string
  cut?: boolean
  /** The rest of a DesktopPrompt a submission is placed by
   *  (desk-prompt-row-owners.ts): the row a hook copy names, when it reached
   *  the phone, and on a status copy its hook copy's. */
  anchorId?: string
  seenAt?: number
  hookTwin?: DesktopPrompt['hookTwin']
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
/** A photo chip as Claude Code draws it, `[Image #N]`. */
const PHOTO_CHIP = /\[Image\s+#\d+\]/

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
    text: normalizeNativeChatUserText(receipt.text),
    chipsOnly: PHOTO_CHIP.test(receipt.text)
  }))
  // Keyed by nonce: a beacon repeats the same reading while it is the latest,
  // so the same submission must not confirm two different sends.
  const claimedNonces = new Set<string>()
  const confirmed: UnconfirmedSend[] = []
  for (const entry of entries) {
    // An empty send has no text to match on, and an empty receipt would match
    // everything by prefix. The one empty send there is, a photo with no caption, is
    // matched by a copy of chips alone (`[Image #N]`, which normalizing takes out): Claude
    // numbers every photo anew, so such a copy the phone did not hold when it sent is a new
    // photo prompt. Only with that list of held copies: without it an old one would do.
    const photoOnly = entry.normalizedText === ''
    if (photoOnly && !entry.knownReceiptNonces) {
      continue
    }
    const receipt = normalized.find((candidate) => {
      // Taken by another send already, here or before (S1, native-chat-send-claims.ts).
      if (claimedNonces.has(candidate.nonce) || nonceClaimedByAnother(candidate.nonce, entry.outboxId)) {
        return false
      }
      if (photoOnly) {
        return candidate.text === '' && candidate.chipsOnly && !entry.knownReceiptNonces!.has(candidate.nonce)
      }
      if (candidate.text === '') {
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
      if (entry.outboxId) {
        claimNonceForSend(entry.outboxId, receipt.nonce)
      }
      confirmed.push(entry)
    }
  }
  return confirmed
}
