import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  findLandedImagePreviewEchoes,
  mergeLandedImagePreviewEchoes,
  migrateImagePreviewMessageIds,
  type LandedImagePreviewEcho
} from './mobile-native-chat-draft-reconcile'
import { rebaseMobileNativeChatPendingBaselines } from './mobile-native-chat-pending-baseline'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { retireLandedMobileNativeChatPending } from './mobile-native-chat-pending-retirement'

const NO_PREVIEWS: LandedImagePreviewEcho[] = []
const NO_IDS: ReadonlySet<string> = new Set()
const NO_STORED_PREVIEWS: Record<string, string[]> = {}

/** The phone's own sends after one transcript read is taken in. */
export type LandedOwnSends = {
  /** The sends still waiting for a row: rebased onto a settled read, and
   *  without every one whose row has landed. */
  pending: MobileNativeChatPendingMessage[]
  /** The rebased list the binder saw, before retirement. */
  rebased: MobileNativeChatPendingMessage[]
  /** The phone's photos each landed row takes from the send it replaces. */
  landedImagePreviews: LandedImagePreviewEcho[]
  landedImagePendingIds: ReadonlySet<string>
}

/**
 * Which of the phone's sends this read's rows replace, and the photos those
 * rows take from them, decided in one place for the render and the store.
 *
 * Both used to be decided only in the draft store's effect, which runs after
 * the render that first draws the new rows. So for one frame a photo message
 * was drawn twice: the bubble with the phone's pictures, and its own row with
 * none, whose `[Image #N]` markers and `[Image: source: …]` paths draw as
 * "Image on Desktop". Then the effect retired the bubble and bound the
 * pictures, and the list redrew (2026-09-26, Claude Code 2.1.281: "it
 * glitching and showing its from my Images from Desktop then screen flashed
 * and showd the images preview"). The render now draws what the effect is
 * about to store, from the same pass.
 *
 * Rebase first, so the binder sees the list retirement will: rebasing only
 * inside retirement left a photo sent before the transcript settled invisible
 * to the binder yet retirable in that same pass (2026-09-14 review).
 */
export function settleLandedOwnSends(
  messages: readonly NativeChatMessage[],
  pending: MobileNativeChatPendingMessage[],
  transcriptSettled: boolean
): LandedOwnSends {
  if (pending.length === 0) {
    return { pending, rebased: pending, landedImagePreviews: NO_PREVIEWS, landedImagePendingIds: NO_IDS }
  }
  // Only a send judged against a read known to be this session's binds. That
  // does NOT give an image echo a boundary (the rebase leaves those on
  // whatever they captured), so a caption-less photo sent before any read
  // settled can still claim an older photo turn.
  const rebased = transcriptSettled ? rebaseMobileNativeChatPendingBaselines(messages, pending) : pending
  const landedImagePreviews = findLandedImagePreviewEchoes(
    messages,
    rebased.filter((item) => item.baselineResolved)
  )
  const landedImagePendingIds = landedImagePreviews.length
    ? new Set(landedImagePreviews.map((preview) => preview.pendingId))
    : NO_IDS
  return {
    pending: retireLandedMobileNativeChatPending(messages, rebased, landedImagePendingIds),
    rebased,
    landedImagePreviews,
    landedImagePendingIds
  }
}

/**
 * The list the store keeps for its session: the settled one when the store
 * still holds the list it was settled from, otherwise the store's own list
 * put through the same retirement (a send accepted in between).
 */
export function storedAfterLanding(
  messages: readonly NativeChatMessage[],
  stored: MobileNativeChatPendingMessage[],
  settledFrom: MobileNativeChatPendingMessage[],
  settled: LandedOwnSends
): MobileNativeChatPendingMessage[] {
  if (stored === settledFrom) {
    return settled.pending
  }
  return retireLandedMobileNativeChatPending(
    messages,
    rebaseMobileNativeChatPendingBaselines(messages, stored),
    settled.landedImagePendingIds
  )
}

/** The phone's previews as the chat draws them for this read: the stored ones,
 *  moved to the prompt a photo-only frame folded into, and the ones rows that
 *  landed in this read take from their sends. The same object when neither
 *  moves anything. No session, no previews. */
export function previewsAsDrawn(
  stored: Record<string, string[]> | undefined,
  sessionKey: string | null,
  messages: readonly NativeChatMessage[],
  settled: LandedOwnSends | null
): Record<string, string[]> {
  if (!sessionKey) {
    return NO_STORED_PREVIEWS
  }
  const kept = stored ?? NO_STORED_PREVIEWS
  const migrated = migrateImagePreviewMessageIds({ [sessionKey]: kept }, sessionKey, messages)
  const landed = settled?.landedImagePreviews ?? NO_PREVIEWS
  const drawn = landed.length > 0 ? mergeLandedImagePreviewEchoes(migrated, sessionKey, landed) : migrated
  return drawn[sessionKey] ?? kept
}
