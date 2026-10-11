import { openImageMarkup } from './image-markup-store'

/**
 * Where a picture marked up from the chat goes: the open chat's composer, as
 * a new attachment. The Claude app's viewer has a pencil left of its download
 * button (the user's screenshots, 2026-10-11); this is the same markup editor
 * the composer's own photo chips open (MobileImageMarkupEditor.tsx), opened on
 * a picture the agent read or sent.
 *
 * The open chat registers its composer's attach here (MobileNativeChatOverlay);
 * with none registered (no chat on screen, or one that cannot attach) the
 * viewer draws no pencil, rather than one whose Done goes nowhere.
 */
export type ChatMarkupAttach = (base64: string, mimeType: 'image/png' | 'image/jpeg') => Promise<void>

let target: ChatMarkupAttach | null = null

/** Registers the composer's attach; the returned function unregisters it,
 *  and only if it is still this one (a newer chat may have taken over). */
export function setChatMarkupAttachTarget(attach: ChatMarkupAttach): () => void {
  target = attach
  return () => {
    if (target === attach) {
      target = null
    }
  }
}

/** Opens the markup editor on `uri`, its Done attaching the drawn picture
 *  to the composer; undefined when there is no composer to attach to. */
export function chatMarkupOpener(uri: string): (() => void) | undefined {
  if (!target) {
    return undefined
  }
  return () => {
    openImageMarkup(uri, {
      onDone: (result) => {
        // Read at Done, not at open: the chat that opened it may have gone.
        const attach = target
        if (!attach) {
          console.warn('[chat-markup] the marked-up picture had no composer to go to: the chat closed while it was drawn')
          return
        }
        void attach(result.base64, result.mimeType)
      }
    })
  }
}

export function resetChatMarkupAttachTargetForTests(): void {
  target = null
}
