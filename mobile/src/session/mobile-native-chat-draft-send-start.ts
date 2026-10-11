import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import { noteOutboxEcho, offerOutboxAdoption, recordOutboxSend } from './native-chat-outbox-sends'

/** Puts a send's words and bubble back. */
export type UndoNativeChatSendStart = () => void

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
 *  chips AND the echo back together.
 *
 *  All or nothing: a step that throws once the box has emptied puts the words and the bubble
 *  back before the throw goes on, so the caller, which takes the chips only after this returns,
 *  finds the composer as it was. It used to leave the words gone and the bubble drawn beside the
 *  chips, a message drawn as sent that nothing typed (2026-10-11). */
export function clearDraftAtSendStartWith(
  drafts: {
    captureSendOrigin: (text: string) => MobileNativeChatSendOrigin | null
    clearDraftForSend: (origin: MobileNativeChatSendOrigin, text: string) => void
    restoreRejectedDraft: (origin: MobileNativeChatSendOrigin, text: string) => void
    acceptSend: (origin: MobileNativeChatSendOrigin, text: string, images?: string[], imagePaths?: string[]) => string | null
    removePending: (id: string) => void
  },
  text: string,
  images?: string[],
  imagePaths?: string[]
): UndoNativeChatSendStart | null {
  const origin = drafts.captureSendOrigin(text)
  if (!origin) {
    return null
  }
  let cleared = false
  let pendingId: string | null = null
  const undo = (): void => {
    if (!cleared) {
      return
    }
    drafts.restoreRejectedDraft(origin, text)
    if (pendingId) {
      drafts.removePending(pendingId)
    }
  }
  try {
    // Written down before the box empties, and handed to the text send this same press makes
    // next, so the press has one outbox entry (native-chat-outbox-sends.ts).
    // A terminal photo send knows the desktop paths it will paste: kept, so the app-wide drainer
    // can paste them again (native-chat-outbox-drainer.ts). Only when they pair one to one.
    const attachments =
      images?.length && imagePaths?.length === images.length
        ? images.map((previewUri, index) => ({ path: imagePaths[index]!, previewUri }))
        : undefined
    recordOutboxSend(origin, text, { hasAttachments: Boolean(images?.length), ...(attachments ? { attachments } : {}) })
    if (origin.outboxId) {
      offerOutboxAdoption(origin.draftKey, origin.normalizedText, origin.outboxId, false)
    }
    drafts.clearDraftForSend(origin, text)
    cleared = true
    pendingId = images?.length ? drafts.acceptSend(origin, text, images, imagePaths) : null
    if (pendingId) {
      noteOutboxEcho(origin, pendingId)
    }
  } catch (error) {
    undo()
    throw error
  }
  return undo
}
