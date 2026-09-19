import type { NativeChatBlock, NativeChatImageRefBlock } from '../../../src/shared/native-chat-types'
import { splitOrcaPastedImagePaths } from '../../../src/shared/native-chat-pasted-image-paths'

/** Claude Code writes a pasted image into the prompt text as `[Image #1]`.
 *  The horizontal space before it goes with it, so the caption does not keep
 *  a double space where the marker sat. */
const IMAGE_PROMPT_MARKERS = /[^\S\r\n]*\[Image #\d+\]/g

/**
 * The `path` of an image block standing in for a `[Image #N]` the phone has
 * no bytes for. Not a file, and never opened as one: the chip renderer draws
 * it as "Image on Desktop", the same chip a desktop clipboard path gets. A
 * local preview the phone holds fills the block's `url` further down the
 * pipeline (`buildMobileNativeChatTransientData`), and then it is a picture.
 */
export const DESKTOP_PROMPT_IMAGE_REF = 'desktop-image'

/**
 * Keep a desktop-pasted image VISIBLE in the prompt the phone draws, as a
 * chip rather than the picture itself.
 *
 * The phone has no bytes for an image pasted on the desktop — they never reach
 * it — so it cannot draw the image, and it used to strip the marker out
 * entirely. That left the message reading as though nothing had been attached:
 * a prompt that said "see this [Image #1]" arrived on the phone as "see this",
 * with no sign an image was ever part of it. Reported 2026-09-15.
 *
 * The first fix spliced the words "Image on Desktop" into the sentence, which
 * read as the user's own text ("see this Image on Desktop i already send",
 * device 2026-09-19). A send from the phone lays its pictures out as blocks
 * above the caption, so a desktop image now does the same: one image block per
 * marker, then the caption with the markers gone.
 */
export function desktopPromptImageBlocks(text: string): NativeChatBlock[] {
  const markers = text.match(IMAGE_PROMPT_MARKERS)?.length ?? 0
  if (markers === 0) {
    return [{ type: 'text', text }]
  }
  const blocks: NativeChatBlock[] = []
  for (let index = 0; index < markers; index += 1) {
    blocks.push({ type: 'image-ref', path: DESKTOP_PROMPT_IMAGE_REF })
  }
  const caption = text.replace(IMAGE_PROMPT_MARKERS, '').trim()
  if (caption) {
    blocks.push({ type: 'text', text: caption })
  }
  return blocks
}

/** True for an image block that lives on the desktop and not on the phone: a
 *  marker stand-in above, or a desktop clipboard file. A block a local preview
 *  has filled is a picture and is not this. */
export function isDesktopImageRef(block: NativeChatImageRefBlock): boolean {
  if (block.url) {
    return false
  }
  const path = block.path ?? ''
  return path === DESKTOP_PROMPT_IMAGE_REF || splitOrcaPastedImagePaths(path).paths.length > 0
}
