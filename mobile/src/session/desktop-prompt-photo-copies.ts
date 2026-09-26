import type { DesktopPrompt } from './agent-hud-beacon'
import { photosOnlyPrompt } from './mobile-native-chat-image-transcript-markers'
import { withoutPasteWrappers } from './mobile-native-chat-paste-wrapper'
import { SEND_STAMP_CLOCK_ALLOWANCE_MS } from './mobile-native-chat-photo-rows'

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
 * So a send keeps the first copy it pairs with, by its marker text: Claude
 * numbers photos through the session, so a desk paste later in the same turn
 * is `[Image #74]` and no longer reads as the send's (fourth review: a phone
 * photo Claude took mid-turn, which never retires, hid a desk paste of as
 * many photos). RAM only: after a relaunch, a send whose own copy the phone
 * never sees again pairs with the first copy of its count it does see.
 */

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

/** Keeps each send's first pairing; a later one never replaces it. */
export function rememberPhotoCopies(claimed: ReadonlyMap<string, string>): void {
  for (const [pendingId, text] of claimed) {
    if (!bindings.has(pendingId)) {
      bindings.set(pendingId, text)
    }
  }
  for (const oldest of bindings.keys()) {
    if (bindings.size <= BINDINGS_KEPT) {
      break
    }
    bindings.delete(oldest)
  }
}

export function resetPhotoCopyBindingsForTests(): void {
  bindings.clear()
}

/** Whether a markers-only hook prompt can be the copy of a phone send of
 *  `photos` photos and no words. */
export function reportsPhotoCopy(
  prompt: DesktopPrompt,
  photos: number,
  sentAt: number | undefined,
  marginMs: number,
  bound: string | undefined
): boolean {
  if (photos === 0 || typeof sentAt !== 'number' || photosOnlyPrompt(withoutPasteWrappers(prompt.text)) !== photos) {
    return false
  }
  if (bound !== undefined && bound !== photoCopyText(prompt)) {
    return false
  }
  const watchedBefore =
    prompt.at !== undefined &&
    prompt.atStateStart !== true &&
    prompt.at < sentAt - Math.max(marginMs, SEND_STAMP_CLOCK_ALLOWANCE_MS)
  return !watchedBefore
}
