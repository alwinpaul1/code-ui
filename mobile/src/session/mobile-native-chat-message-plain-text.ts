import { isTextBlock } from '../../../src/shared/native-chat-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

/** Copy the displayed prose, excluding tool activity and image attachments.
 *  Upstream (Orca #22871) swaps a host-status block for the line it draws;
 *  this fork vendors no host-status rows, so every text block is its own text. */
export function nativeChatMessagePlainText(message: Pick<NativeChatMessage, 'blocks'>): string {
  // Preserve indentation in code and nested lists.
  return message.blocks
    .filter(isTextBlock)
    .map((block) => block.text)
    .filter((text) => text.trim().length > 0)
    .join('\n\n')
}
