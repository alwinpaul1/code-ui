import { isImageRefBlock, isTextBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { PendingImagePreviewEcho } from './mobile-native-chat-draft-reconcile'
import { splitOrcaPastedImagePaths } from '../../../src/shared/native-chat-pasted-image-paths'

// Which row is a photo send's, for findLandedImagePreviewEchoes: by the
// paths the send pasted where the row names them, and otherwise by the rules
// that guess (room left on a row, and when it was written). Claude Code
// writes `[Image: source: <path>]` beside a photo row (after the prompt from
// 2.1.228 on, the same millisecond on 2.1.283), Codex carries the path as the
// row's image block, and the path is the one the phone's paste typed
// (use-mobile-native-chat-image-attachments.ts).

/** A photo's name: the last part of its path. A pasted photo's is
 *  `orca-paste-<ms>-<uuid>.<ext>`, one of a kind, and the same whether the
 *  path reads `/private/var/…` or `/var/…`. */
function photoName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

/** The names of the photos a row carries by path; none for a row that names
 *  none, such as a chip drawn for a photo whose path the row does not give. */
export function photoNames(message: NativeChatMessage): string[] {
  return message.blocks.flatMap((block) =>
    isImageRefBlock(block) && block.path && /[\\/]/.test(block.path) ? [photoName(block.path)] : []
  )
}

/** Each photo the send pasted, by name, to its preview; null when the send
 *  kept no paths or they do not pair with its previews. */
export function pastedPhotos(entry: { images?: readonly string[]; imagePaths?: readonly string[] }): Map<string, string> | null {
  const { images, imagePaths } = entry
  if (!images?.length || imagePaths?.length !== images.length) {
    return null
  }
  const named = new Map<string, string>()
  imagePaths.forEach((path, index) => {
    if (typeof path === 'string' && /[\\/]/.test(path)) {
      named.set(photoName(path), images[index]!)
    }
  })
  return named.size > 0 ? named : null
}

/** The previews a row draws, one per image block in its order: the send's
 *  own photo where the block names it, what the row drew there before, and
 *  otherwise nothing, which leaves that block the desktop's. A photo of the
 *  send's that no block names (one that failed to attach) still shows, after
 *  them, as the phone's. */
export function placedByName(
  message: NativeChatMessage,
  pasted: ReadonlyMap<string, string>,
  before: readonly string[]
): string[] {
  const named = new Set<string>()
  const placed = message.blocks.filter(isImageRefBlock).map((block, index) => {
    const name = block.path && /[\\/]/.test(block.path) ? photoName(block.path) : null
    const own = name ? pasted.get(name) : undefined
    if (own !== undefined) {
      named.add(name!)
    }
    return own ?? before[index] ?? ''
  })
  const unnamed = [...pasted].flatMap(([name, preview]) => (named.has(name) ? [] : [preview]))
  // A row with fewer blocks than it drew keeps what it drew past them.
  return [...placed, ...before.slice(placed.length), ...unnamed]
}

/** How much older than the newest row a row written after the send may look
 *  beyond the time since the send: stamps are taken when a record is made, and
 *  records can be written a little out of order. */
const SEND_ROW_ORDER_SLACK_MS = 5_000
const IMAGE_PROMPT_MARKERS = /\[Image #\d+\]/g

/** How many photos a row has room for: its image blocks, or the `[Image #N]`
 *  markers its words carried before its companion landed; at least one. */
export function photoSlots(message: NativeChatMessage, raw: NativeChatMessage | undefined): number {
  const blocks = message.blocks.filter(isImageRefBlock).length
  const markers = (raw ?? message).blocks.reduce(
    (count, block) => count + (isTextBlock(block) ? (block.text.match(IMAGE_PROMPT_MARKERS)?.length ?? 0) : 0),
    0
  )
  return Math.max(1, blocks, markers)
}

/**
 * A row written before the phone sent this is another message's. For a send
 * made before the chat's read settled the tail cannot say so: it is whatever
 * the phone had, an earlier visit's transcript or nothing, and a photo sent
 * with no words took the first photo row after it, an older message's, which
 * then drew the new photo while the new row drew "Image on Desktop"
 * (2026-09-26, Claude Code 2.1.283).
 *
 * Told without setting the phone's clock against the desktop's: a row
 * written after the send is older than the newest row by at most the time
 * since the send, and each of those two spans is read off one clock. The
 * first version compared the send's time with the row's stamp, and a phone
 * running a minute ahead refused the send's own row, which a photo with no
 * words cannot retire without (review, 2026-09-26). A photo with words is
 * asked too: its words can be an older row's as well.
 *
 * It is asked only of rows that name no photo: where a row names one, the
 * path rule in findLandedImagePreviewEchoes decides. So it matters for a
 * send from an older build, a host whose rows name no photo, and a prompt
 * row read before its companion. It cannot tell an older row answered within
 * seconds of the newest from the send's own; the path rule can.
 */
export function writtenBefore(
  message: NativeChatMessage,
  entry: PendingImagePreviewEcho,
  newestStamp: number | null,
  now: number
): boolean {
  return (
    entry.sentBeforeReadSettled === true &&
    typeof entry.sentAt === 'number' &&
    Number.isFinite(entry.sentAt) &&
    message.timestamp !== null &&
    newestStamp !== null &&
    newestStamp - message.timestamp > now - entry.sentAt + SEND_ROW_ORDER_SLACK_MS
  )
}

/** Whether a row carries a photo at all: an image block, or an `[Image #N]`
 *  marker its words carried before its companion landed. */
export function carriesPhoto(message: NativeChatMessage, raw: NativeChatMessage | undefined): boolean {
  return (
    message.blocks.some(isImageRefBlock) ||
    (raw ?? message).blocks.some((block) => isTextBlock(block) && new RegExp(IMAGE_PROMPT_MARKERS.source).test(block.text))
  )
}

/** Whether the send's own row will name the paths it pasted in a form the
 *  phone reads: each is an Orca paste on a macOS host
 *  (`/var/folders/…/T/orca-paste-<ms>-<uuid>.<ext>`), which the agent's
 *  `[Image: source: …]` companion (Claude Code) or image block (Codex)
 *  carries as written. Read off the send, since the rows loaded so far may
 *  hold no photo at all. */
export function rowWillNamePastedPhotos(entry: { images?: readonly string[]; imagePaths?: readonly string[] }): boolean {
  return (
    pastedPhotos(entry) !== null &&
    entry.imagePaths!.every((path) => splitOrcaPastedImagePaths(path).paths.length === 1)
  )
}
