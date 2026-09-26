import type { DesktopPrompt } from './agent-hud-beacon'
import { imageMarkerNumbers, photosOnlyPrompt } from './mobile-native-chat-image-transcript-markers'
import { withoutPasteWrappers } from './mobile-native-chat-paste-wrapper'
import { STATUS_PROMPT_NONCE_PREFIX } from './agent-status-prompts'

/**
 * A photo sent from the phone with no words, and Orca's hook copy of it.
 *
 * The hook reports such a send as its markers alone, `[Image #73]`, as many as
 * it has photos (third review, 2026-09-26: never paired, the copy stood beside
 * the phone's photo as an "Image on Desktop" bubble). A photo pasted at the
 * desk with no words reads the same. The copy's time cannot tell them apart:
 * a copy read on a return to the chat is timed by when the pane's state began,
 * which can be minutes before or after the send; one read after a missed
 * update by a later ping; and the beacon's copy has no time (fifth review: each
 * drew "Image on Desktop" beside the phone's photo). Only a copy the phone
 * watched arrive before the send is ruled out by time, since the row that
 * carries a prompt is never timed before the prompt was taken.
 *
 * Claude numbers photos through the session, so a send's own copy is
 * numbered above every photo the transcript named when it left the phone
 * (`markersBefore`): a copy at or below that is an older photo's. And a send
 * keeps the first copy it pairs with, by its marker text, so a desk paste
 * later in the same turn is `[Image #74]` and no longer reads as the send's (fourth review: a phone
 * photo Claude took mid-turn, which never retires, hid a desk paste of as
 * many photos). RAM only: after a relaunch, a send whose own copy the phone
 * never sees again pairs with the first copy of its count it does see.
 */

/** How far a phone's clock may run ahead of the desk's before a copy the
 *  phone watched arrive just after a send reads as arriving before it. */
const SEND_CLOCK_ALLOWANCE_MS = 5_000

const bindings = new Map<string, string>()
const BINDINGS_KEPT = 256

/** The copy's markers, as the binding compares them. */
export function photoCopyText(prompt: DesktopPrompt): string {
  return withoutPasteWrappers(prompt.text).replace(/\s+/g, ' ').trim()
}

/** The marker text a send paired with first, if any. */
export function boundPhotoCopy(pendingId: string): string | undefined {
  return bindings.get(pendingId)
}

/** The status copies a phone photo send claimed, by session and markers:
 *  still its own after the send retires. A return to the chat reads the tab
 *  status afresh, and when a long turn has pushed the photo's row above the
 *  loaded window nothing else says the copy has landed (seventh review: it
 *  drew as "Image on Desktop"). Claude numbers photos per session, so the
 *  session is part of the key. */
const ownStatusCopies = new Set<string>()

function statusCopyKey(prompt: DesktopPrompt): string | null {
  if (!prompt.nonce.startsWith(STATUS_PROMPT_NONCE_PREFIX)) {
    return null
  }
  // `status:<session>:<time>:<index>`
  const rest = prompt.nonce.slice(STATUS_PROMPT_NONCE_PREFIX.length)
  const session = rest.slice(0, rest.lastIndexOf(':', rest.lastIndexOf(':') - 1))
  return session ? `${session}\0${photoCopyText(prompt)}` : null
}

/** Whether a status copy is one a phone photo send already claimed. */
export function isOwnPhotoStatusCopy(prompt: DesktopPrompt): boolean {
  const key = statusCopyKey(prompt)
  return key !== null && ownStatusCopies.has(key)
}

/** Keeps each send's first pairing; a later one never replaces it. */
export function rememberPhotoCopies(claimed: ReadonlyMap<string, DesktopPrompt>): void {
  for (const [pendingId, prompt] of claimed) {
    if (!bindings.has(pendingId)) {
      bindings.set(pendingId, photoCopyText(prompt))
    }
    const key = statusCopyKey(prompt)
    if (key !== null) {
      ownStatusCopies.add(key)
    }
  }
  for (const oldest of bindings.keys()) {
    if (bindings.size <= BINDINGS_KEPT) {
      break
    }
    bindings.delete(oldest)
  }
  for (const oldest of ownStatusCopies) {
    if (ownStatusCopies.size <= BINDINGS_KEPT) {
      break
    }
    ownStatusCopies.delete(oldest)
  }
}

export function resetPhotoCopyBindingsForTests(): void {
  bindings.clear()
  ownStatusCopies.clear()
}

/** Whether a markers-only hook prompt can be the copy of a phone send of
 *  `photos` photos and no words. */
export function reportsPhotoCopy(
  prompt: DesktopPrompt,
  photos: number,
  sentAt: number | undefined,
  marginMs: number,
  bound: string | undefined,
  markersBefore?: number
): boolean {
  if (photos === 0 || typeof sentAt !== 'number' || photosOnlyPrompt(withoutPasteWrappers(prompt.text)) !== photos) {
    return false
  }
  // Numbered at or below a photo the transcript already named when the send
  // left: an older photo's copy, which the send met before its own arrived
  // (sixth review: it bound to it and drew its own as "Image on Desktop").
  if (typeof markersBefore === 'number' && imageMarkerNumbers(prompt.text).some((number) => number <= markersBefore)) {
    return false
  }
  if (bound !== undefined && bound !== photoCopyText(prompt)) {
    return false
  }
  const watchedBefore =
    prompt.at !== undefined &&
    prompt.atStateStart !== true &&
    prompt.at < sentAt - Math.max(marginMs, SEND_CLOCK_ALLOWANCE_MS)
  return !watchedBefore
}
