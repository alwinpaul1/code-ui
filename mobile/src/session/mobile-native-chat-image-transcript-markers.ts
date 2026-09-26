// Single-sources the marker logic (pure functions over shared types):
// Claude records an attached image as `[Image: source: /path]` (+ `[Image #N]`
// on the caption turn), and both render and echo reconciliation must
// agree with desktop on how those marker turns are interpreted.
export {
  imageSourcePathFromText,
  hasImagePromptMarker,
  isImageSourceUserTurn,
  normalizeImageTranscriptMessages,
  normalizeNativeChatUserText,
  normalizedNativeChatUserMessageText,
  stripImagePromptMarker
} from '../../../src/shared/native-chat-image-transcript-markers'

import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

const IMAGE_MARKERS = /\[Image #\d+\]/g
const IMAGE_MARKER_NUMBERS = /\[Image #(\d+)\]/g

/** The `[Image #N]` numbers in a text, in order. */
export function imageMarkerNumbers(text: string): number[] {
  return [...text.matchAll(IMAGE_MARKER_NUMBERS)].map((match) => Number(match[1]))
}

/** The highest `[Image #N]` a transcript's user rows name, or 0. Claude
 *  numbers a session's photos in order, so a photo sent after these rows is
 *  numbered above it. */
export function highestImageMarker(messages: readonly NativeChatMessage[]): number {
  let highest = 0
  for (const message of messages) {
    if (message.role !== 'user') {
      continue
    }
    for (const block of message.blocks) {
      if (block.type === 'text') {
        highest = Math.max(highest, ...imageMarkerNumbers(block.text))
      }
    }
  }
  return highest
}

/** How many photos a prompt of `[Image #N]` markers and nothing else holds:
 *  a photo sent with no words, as the hook reports it. 0 for any other. */
export function photosOnlyPrompt(text: string): number {
  const markers = text.match(IMAGE_MARKERS)?.length ?? 0
  return markers > 0 && text.replace(IMAGE_MARKERS, '').trim() === '' ? markers : 0
}
