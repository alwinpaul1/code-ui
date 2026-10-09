import type { NativeChatTextBlock } from '../../../src/shared/native-chat-types'

/** Whether a text block carries display hints this build knows how to draw. A
 *  hint from a newer host falls through to ordinary prose rather than to a
 *  blank row — the text is always readable on its own. */
export function isRenderableNativeChatNotice(block: NativeChatTextBlock): boolean {
  return (
    block.presentation === 'compaction' ||
    block.presentation === 'plan-document' ||
    block.tone === 'warning' ||
    block.tone === 'error' ||
    block.tone === 'notice'
  )
}
