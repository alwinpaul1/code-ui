import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'

/** An image send pastes, waits for the TUI, then sends the text; the box
 *  must not sit full for that beat (2026-09-13: the Claude app sends both at
 *  once). Clear at the start and hand back the undo for a paste that fails
 *  before the text ever goes. Null when there is no draft scope to clear. */
export function clearDraftAtSendStartWith(
  drafts: {
    captureSendOrigin: (text: string) => MobileNativeChatSendOrigin | null
    clearDraftForSend: (origin: MobileNativeChatSendOrigin, text: string) => void
    restoreRejectedDraft: (origin: MobileNativeChatSendOrigin, text: string) => void
  },
  text: string
): (() => void) | null {
  const origin = drafts.captureSendOrigin(text)
  if (!origin) {
    return null
  }
  drafts.clearDraftForSend(origin, text)
  return () => drafts.restoreRejectedDraft(origin, text)
}
