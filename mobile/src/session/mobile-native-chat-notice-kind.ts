import { isAgentSessionProviderContextBoundary } from '../../../src/shared/agent-session-provider-context'
import type { NativeChatTextBlock } from '../../../src/shared/native-chat-types'

/** Whether a text block carries display hints this build knows how to draw. A
 *  hint from a newer host falls through to ordinary prose rather than to a
 *  blank row — the text is always readable on its own. */
export function isRenderableNativeChatNotice(block: NativeChatTextBlock): boolean {
  return (
    // A /clear's boundary (Orca #26579): the chat stays, earlier messages stay above it.
    isAgentSessionProviderContextBoundary(block.contextClear) ||
    block.presentation === 'compaction' ||
    block.presentation === 'plan-document' ||
    block.tone === 'warning' ||
    block.tone === 'error' ||
    block.tone === 'notice'
  )
}
