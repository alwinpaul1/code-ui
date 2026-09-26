import { isTextBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import { isImageSourceUserTurn } from '../../../src/shared/native-chat-image-transcript-markers'

const IMAGE_PROMPT_MARKER = /\[Image #\d+\]/g
const IMAGE_SOURCE_MARKER = /^\s*\[Image:\s*source:/m

/** How many `[Image #N]` markers a user turn's text carries. */
function promptMarkerCount(message: NativeChatMessage): number {
  let count = 0
  for (const block of message.blocks) {
    if (isTextBlock(block)) {
      count += block.text.match(IMAGE_PROMPT_MARKER)?.length ?? 0
    }
  }
  return count
}

/** How many `[Image: source: …]` companions a stranded turn holds — one per
 *  block, the shape Claude records a multi-image paste in. */
function imageSourceCount(message: NativeChatMessage): number {
  let count = 0
  for (const block of message.blocks) {
    if (isTextBlock(block) && IMAGE_SOURCE_MARKER.test(block.text)) {
      count += 1
    }
  }
  return count
}

/**
 * The prompt an image companion placed at `end` in `rows` belongs to because
 * it was written right after it: the vendored normalizer's trailing fold, for
 * a prompt that names images and has no companions of its own in front of it.
 * Null when there is none, and the companion then belongs to what follows.
 *
 * Claude Code writes a pasted photo's companion AFTER its prompt, a
 * millisecond later. Of the 617 companions on this machine from Claude Code
 * 2.1.228 to 2.1.283 (counted 2026-09-26), 609 sit right after their prompt,
 * 7 after a skill's preamble, a row Orca drops so the two are adjacent on the
 * phone too, and 1 after the rows of a `/goal` command sent with photos. None
 * comes before a prompt written later. Pulling such a companion forward
 * stole one message's photos for the next one that named as many: two
 * three-photo messages from the phone drew the second with the first one's
 * photos, and its own under it as a bubble of three "Image on Desktop" chips
 * with no words (2026-09-26, Claude Code 2.1.281, session 967668df).
 */
export function trailingCompanionOwner(
  rows: readonly NativeChatMessage[],
  end: number,
  companion: NativeChatMessage
): NativeChatMessage | null {
  const source = companion.source
  const ownerAt = rowBehindCompanions(rows, end, source)
  const owner = rows[ownerAt]
  if (!isPhotoPrompt(owner, source)) {
    return null
  }
  // Companions in front of a prompt are its own in the older order, and then
  // the run after it is not; unless they trail an earlier photo message,
  // which is what two photo messages written back to back look like (review,
  // 2026-09-26: the second message's photo went to a third that named as
  // many). So walk back through prompt and companion pairs to the first
  // prompt with none in front of it.
  let at = ownerAt
  for (;;) {
    const behind = rowBehindCompanions(rows, at, source)
    if (behind === at - 1) {
      return owner!
    }
    if (!isPhotoPrompt(rows[behind], source)) {
      return null
    }
    at = behind
  }
}

/** The index of the row before the run of companions that ends at `end`. */
function rowBehindCompanions(rows: readonly NativeChatMessage[], end: number, source: NativeChatMessage['source']): number {
  let at = end - 1
  while (at >= 0 && rows[at]!.source === source && isImageSourceUserTurn(rows[at]!)) {
    at -= 1
  }
  return at
}

function isPhotoPrompt(row: NativeChatMessage | undefined, source: NativeChatMessage['source']): boolean {
  return !!row && row.role === 'user' && row.source === source && promptMarkerCount(row) > 0
}

/**
 * Moves a QUEUED message's image companions down next to the prompt they
 * belong to, so the vendored `normalizeImageTranscriptMessages` — which only
 * pairs an image companion with an IMMEDIATELY-adjacent prompt — can then fold
 * them into the bubble. A run the prompt right before it owns stays put
 * (trailingCompanionOwner).
 *
 * Written for a queued message whose images were recorded when it was
 * composed and its prompt text later, when the queue drained, so the agent's
 * own turns sat between the two and the images rendered ABOVE the message
 * bubble (reported from the phone 2026-09-14). No transcript on this machine
 * still shows that order: from Claude Code 2.1.228 to 2.1.283 a queued row's
 * companion comes right after it, like any other prompt's (2026-09-26). This
 * pass runs BEFORE the normalizer, on the raw transcript, so the `[Image #N]`
 * markers it matches on are still present.
 *
 * It only reorders — the images are placed immediately before their prompt, and
 * the agent's turns keep their order. Every guard fails closed: the run folds
 * only when the turns between it and the prompt are the agent's own (no other
 * user turn intervenes) and the prompt names exactly as many images as were
 * stranded, so a photo sent on its own is never pulled into a later message.
 */
export function foldQueuedImageTurns(messages: NativeChatMessage[]): NativeChatMessage[] {
  const out: NativeChatMessage[] = []
  const consumed = new Set<number>()
  for (let index = 0; index < messages.length; index += 1) {
    if (consumed.has(index)) {
      continue
    }
    const message = messages[index]!
    // A run the loaded window starts with trails a prompt on the page before
    // it, and is not the next photo message's (review, 2026-09-26).
    if (!isImageSourceUserTurn(message) || out.length === 0 || trailingCompanionOwner(out, out.length, message)) {
      out.push(message)
      continue
    }
    // Collect the run of consecutive image-source turns and their image count.
    const run: NativeChatMessage[] = [message]
    let images = imageSourceCount(message)
    let scan = index + 1
    while (scan < messages.length && isImageSourceUserTurn(messages[scan]!)) {
      run.push(messages[scan]!)
      images += imageSourceCount(messages[scan]!)
      scan += 1
    }
    // Look past the agent's own turns for the prompt that owns these images.
    // An intervening USER turn means they belong to an earlier context.
    let promptIndex = -1
    for (let ahead = scan; ahead < messages.length; ahead += 1) {
      if (messages[ahead]!.role === 'user') {
        promptIndex = ahead
        break
      }
    }
    const prompt = promptIndex >= 0 ? messages[promptIndex]! : null
    if (!prompt || promptIndex === scan || promptMarkerCount(prompt) !== images) {
      // No agent turns between them (already adjacent — the normalizer handles
      // it), or no matching prompt: leave the run untouched.
      out.push(message)
      continue
    }
    // Reorder: the agent's turns first, then the image companions, then the
    // prompt — so the normalizer sees the images adjacent to it. Mark every
    // moved turn consumed so the outer loop does not re-emit it.
    for (let cursor = index; cursor <= promptIndex; cursor += 1) {
      consumed.add(cursor)
    }
    for (let between = scan; between < promptIndex; between += 1) {
      out.push(messages[between]!)
    }
    out.push(...run, prompt)
  }
  return out
}
