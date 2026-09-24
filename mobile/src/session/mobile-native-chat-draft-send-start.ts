import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'

/** An image send pastes, waits for the TUI, then sends the text; the box
 *  must not sit full for that beat (2026-09-13: the Claude app sends both at
 *  once). Clear at the start and hand back the undo for a paste that fails
 *  before the text ever goes. Null when there is no draft scope to clear.
 *
 *  `images`, when given, adds the optimistic bubble in this SAME call rather
 *  than after the send round-trip settles (2026-09-24: the chips lingered in
 *  the composer after the text left, then the bubble popped in once the RPC
 *  resolved — the Claude app shows all three together, at once). The undo
 *  also retracts that bubble, so a definite rejection puts the text, the
 *  chips AND the echo back together. */
export function clearDraftAtSendStartWith(
  drafts: {
    captureSendOrigin: (text: string) => MobileNativeChatSendOrigin | null
    clearDraftForSend: (origin: MobileNativeChatSendOrigin, text: string) => void
    restoreRejectedDraft: (origin: MobileNativeChatSendOrigin, text: string) => void
    acceptSend: (origin: MobileNativeChatSendOrigin, text: string, images?: string[]) => string | null
    removePending: (id: string) => void
  },
  text: string,
  images?: string[]
): (() => void) | null {
  const origin = drafts.captureSendOrigin(text)
  if (!origin) {
    return null
  }
  drafts.clearDraftForSend(origin, text)
  const pendingId = images?.length ? drafts.acceptSend(origin, text, images) : null
  return () => {
    drafts.restoreRejectedDraft(origin, text)
    if (pendingId) {
      drafts.removePending(pendingId)
    }
  }
}
