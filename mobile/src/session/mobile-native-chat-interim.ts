import { isTextBlock, isToolCallBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'

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
    const hasProse = message.blocks.some((block) => isTextBlock(block) && block.text.trim().length > 0)
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
