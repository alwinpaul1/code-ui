import { isImageRefBlock, isTextBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import { DESKTOP_PROMPT_IMAGE_REF } from './mobile-desktop-prompt-images'
import type { ScreenSentPhotos } from './mobile-terminal-sent-photos'

const NONE: ReadonlyMap<string, number> = new Map()

function flat(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function wordsOf(message: NativeChatMessage): string {
  return flat(
    message.blocks
      .filter(isTextBlock)
      .map((block) => block.text)
      .join(' ')
  )
}

/**
 * Which chat rows the screen showed photos for, by message id, added to what
 * was already known. Kept, not re-derived: the screen shows a message only
 * while Claude has it on screen, and the chips must outlive that.
 *
 * A reading names its message by the `❯` row, which is the start of the
 * message as wrapped to the terminal. It is taken only when exactly one user
 * row the phone has begins with it and draws no image of its own, and only
 * one reading on screen has that text. Anything else is refused: a chip on
 * the wrong message is worse than none.
 */
export function rememberScreenSentPhotos(
  known: ReadonlyMap<string, number>,
  messages: readonly NativeChatMessage[],
  readings: readonly ScreenSentPhotos[]
): ReadonlyMap<string, number> {
  let next: Map<string, number> | null = null
  for (const reading of readings) {
    const prompt = flat(reading.prompt)
    if (prompt === '' || readings.filter((other) => flat(other.prompt) === prompt).length > 1) {
      continue
    }
    const candidates = messages.filter(
      (message) =>
        message.role === 'user' &&
        !message.blocks.some(isImageRefBlock) &&
        wordsOf(message).startsWith(prompt)
    )
    const [only] = candidates
    if (candidates.length !== 1 || !only || (known.get(only.id) ?? 0) >= reading.photos) {
      continue
    }
    next ??= new Map(known)
    next.set(only.id, reading.photos)
  }
  return next ?? (known.size === 0 ? NONE : known)
}

/** One "Image on Desktop" chip per photo, the chip a desktop-pasted image
 *  already gets (the user, 2026-09-24), above the words as a send with
 *  pictures is laid out. A row that already draws an image is left alone. */
export function withScreenSentPhotos(
  messages: readonly NativeChatMessage[],
  known: ReadonlyMap<string, number>
): NativeChatMessage[] {
  if (known.size === 0) {
    return [...messages]
  }
  return messages.map((message) => {
    const photos = known.get(message.id) ?? 0
    if (photos === 0 || message.role !== 'user' || message.blocks.some(isImageRefBlock)) {
      return message
    }
    const chips = Array.from({ length: photos }, () => ({ type: 'image-ref' as const, path: DESKTOP_PROMPT_IMAGE_REF }))
    return { ...message, blocks: [...chips, ...message.blocks] }
  })
}
