import { hasImagePromptMarker } from '../../../src/shared/native-chat-image-transcript-markers'
import { showDesktopPromptImages } from './mobile-desktop-prompt-images'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

/**
 * Put back the sign that an image was sent, when the phone has no picture.
 *
 * `normalizeImageTranscriptMessages` (Orca's, in `src/shared`) turns a prompt's
 * `[Image #N]` markers into real image blocks when the file is at hand, and
 * DELETES them when it is not. On the desktop that is right: the picture is
 * already on screen beside the text. On the phone the bytes never arrive, so
 * deleting the marker left the message reading as though nothing had been
 * attached — "see the host terminal  it had images" with a double space where
 * the picture belonged (device screenshot, 2026-09-15).
 *
 * The pending-echo path already draws "Image on Desktop" for exactly this. A
 * prompt typed while the agent is IDLE gets a real transcript row instead of an
 * echo, and that path had no such treatment.
 *
 * Done here rather than in the shared file because `src/shared` is Orca's,
 * re-vendored and never edited in this repo. So the markers are read off the
 * ORIGINAL rows and restored onto the normalized ones, and only where the
 * normalization produced no image of its own.
 */
export function keepDesktopImagePlaceholders(
  original: readonly NativeChatMessage[],
  normalized: readonly NativeChatMessage[]
): NativeChatMessage[] {
  const markedById = new Map<string, boolean>()
  for (const message of original) {
    if (message.role !== 'user') {
      continue
    }
    if (hasImagePromptMarker(message)) {
      markedById.set(message.id, true)
    }
  }
  if (markedById.size === 0) {
    return [...normalized]
  }
  return normalized.map((message) => {
    if (message.role !== 'user' || !markedById.has(message.id)) {
      return message
    }
    // A row that GAINED an image needs nothing: the picture is the sign.
    if (message.blocks.some((block) => block.type === 'image-ref')) {
      return message
    }
    const originalText = original
      .find((candidate) => candidate.id === message.id)
      ?.blocks.map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
    if (!originalText) {
      return message
    }
    // Existing text blocks only, never an added one. A marker-ONLY turn has no
    // text left, and it may still gain a picture further down the pipeline when
    // the phone holds a local preview of it — appending here put a placeholder
    // beside that picture (caught by mobile-native-chat-render-data.test.ts).
    // Such a turn keeps whatever the preview path gives it.
    const placeheld = showDesktopPromptImages(originalText)
    if (!message.blocks.some((block) => block.type === 'text')) {
      return message
    }
    return {
      ...message,
      blocks: message.blocks.map((block) =>
        block.type === 'text' ? { ...block, text: placeheld } : block
      )
    }
  })
}
