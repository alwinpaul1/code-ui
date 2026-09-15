/** Claude Code writes a pasted image into the prompt text as `[Image #1]`. */
const IMAGE_PROMPT_MARKERS = /\[Image #\d+\]/g

/** What the phone shows in its place. A picture, not a number: the count is the
 *  agent's own index into that turn's attachments and means nothing here. */
const IMAGE_PLACEHOLDER = '🖼 Image'

/**
 * Keep a desktop-pasted image VISIBLE in the prompt the phone draws, as a
 * placeholder rather than the picture itself.
 *
 * The phone has no bytes for an image pasted on the desktop — they never reach
 * it — so it cannot draw the image, and it used to strip the marker out
 * entirely. That left the message reading as though nothing had been attached:
 * a prompt that said "see this [Image #1]" arrived on the phone as "see this",
 * with no sign an image was ever part of it. Reported 2026-09-15.
 *
 * Showing a placeholder is the honest middle: the reader can tell an image was
 * sent and that this device does not have it, instead of silently seeing a
 * different message from the one that was written.
 */
export function showDesktopPromptImages(text: string): string {
  return text.replace(IMAGE_PROMPT_MARKERS, IMAGE_PLACEHOLDER)
}
