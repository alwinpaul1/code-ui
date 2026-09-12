import {
  isTextBlock,
  isToolCallBlock,
  type NativeChatMessage,
  type NativeChatTextBlock
} from '../../../src/shared/native-chat-types'

/**
 * Which assistant messages are interim notes — prose the agent wrote and then
 * kept working past, inside the same turn — as opposed to the answer that
 * closes a turn. The Claude app draws the notes as a quote block with a bar
 * on the left and the closing answer as plain prose (2026-09-12). A turn is
 * everything between two user messages. Oldest-first input.
 */
export function interimAssistantMessageIds(messages: readonly NativeChatMessage[]): Set<string> {
  const interim = new Set<string>()
  let openNote: string | null = null
  for (const message of messages) {
    if (message.role === 'user') {
      openNote = null
      continue
    }
    if (message.role !== 'assistant') {
      continue
    }
    const hasProse = message.blocks.some(
      (block) => isTextBlock(block) && block.text.trim().length > 0 && !isHostNotice(block)
    )
    const hasTools = message.blocks.some(isToolCallBlock)
    if (openNote !== null && (hasProse || hasTools)) {
      // Something followed the note inside the turn: it was not the answer.
      interim.add(openNote)
      openNote = null
    }
    if (hasProse) {
      openNote = message.id
    }
  }
  return interim
}

/** An API-error line ("Please run /login · API Error: 401 …") or a toned host
 *  notice is not the agent working past its answer, so it neither closes a
 *  note nor opens one (2026-09-12: a 401 after the answer put the whole
 *  answer in a quote block). Claude Code writes the error as an assistant
 *  record with `isApiErrorMessage`; the phone only sees its text. */
function isHostNotice(block: NativeChatTextBlock): boolean {
  return block.tone !== undefined || API_ERROR_LINE.test(block.text)
}

const API_ERROR_LINE = /(^|·\s*)API Error:\s*\d{3}/
