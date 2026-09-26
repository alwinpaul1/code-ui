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

const IMAGE_MARKERS = /\[Image #\d+\]/g

/** How many photos a prompt of `[Image #N]` markers and nothing else holds:
 *  a photo sent with no words, as the hook reports it. 0 for any other. */
export function photosOnlyPrompt(text: string): number {
  const markers = text.match(IMAGE_MARKERS)?.length ?? 0
  return markers > 0 && text.replace(IMAGE_MARKERS, '').trim() === '' ? markers : 0
}
