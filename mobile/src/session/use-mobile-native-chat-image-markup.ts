import { useCallback } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import {
  markedUpNativeChatImagePreviewUri,
  uploadMarkedUpNativeChatImage,
  type PendingNativeChatImage
} from './mobile-native-chat-image-attachment'

type Args = {
  readonly client: RpcClient | null
  readonly getActiveWorktreeConnectionId: () => Promise<string | null>
  readonly scopeKey: string | null
  /** Draws the chip uploading with its marks; returns the chip as it was, or
   *  null when the scope holds no chip by that id or it is uploading already. */
  readonly markAttachmentReuploading: (
    scope: string,
    id: string,
    previewUri: string
  ) => PendingNativeChatImage | null
  readonly replaceAttachmentImage: (
    scope: string,
    id: string,
    next: { path: string; previewUri: string; contentFingerprint?: string }
  ) => void
  /** The attach failures' own channel, not the send banner: this is attach-side. */
  readonly showToast: (message: string, durationMs?: number) => void
}

/** The markup editor's Done: re-uploads the flattened PNG the same way the
 *  original picker upload did, then swaps it into the chip at `id`. Split out
 *  of `use-mobile-native-chat-image-attachments` for that file's line ceiling
 *  (the same reason `use-native-chat-attachment-scope-writers` exists) — the
 *  upload is the only part of the replace that is asynchronous. */
export function useMobileNativeChatImageMarkup({
  client,
  getActiveWorktreeConnectionId,
  scopeKey,
  markAttachmentReuploading,
  replaceAttachmentImage,
  showToast
}: Args): (id: string, base64: string) => Promise<void> {
  return useCallback(
    async (id: string, base64: string): Promise<void> => {
      const scope = scopeKey
      // No scope has no chip to put it in: Done calls back into the render the
      // editor opened from, whose scope held the tapped chip.
      if (!scope) {
        return
      }
      // Never throws, and never returns without a word: the editor has closed
      // by Done and voids this promise, so a failure said nowhere else let the
      // unmarked photo go out as if marked up (2026-09-25 sweep). Chips sit in
      // a module-level store and outlive the host's client, so a Done with no
      // client is one of those failures.
      const notSaved = (): void =>
        showToast('Markup not saved — the photo is still attached without it', 1500)
      if (!client) {
        notSaved()
        return
      }
      // The chip shows its marks under the loading ring until the host has
      // them, so a send tapped meanwhile waits for them instead of pasting the
      // photo as it was (2026-09-26: the marked copy went with the next send).
      const before = markAttachmentReuploading(scope, id, markedUpNativeChatImagePreviewUri(base64))
      // Nothing to mark: the chip is gone, or a second tap on Done already
      // has the same marks on their way, and that upload says how it went.
      if (!before) {
        return
      }
      let uploaded: Awaited<ReturnType<typeof uploadMarkedUpNativeChatImage>>
      try {
        uploaded = await uploadMarkedUpNativeChatImage(base64, {
          client,
          getConnectionId: getActiveWorktreeConnectionId
        })
      } catch {
        replaceAttachmentImage(scope, id, before)
        notSaved()
        return
      }
      replaceAttachmentImage(scope, id, uploaded)
    },
    [
      client,
      getActiveWorktreeConnectionId,
      scopeKey,
      markAttachmentReuploading,
      replaceAttachmentImage,
      showToast
    ]
  )
}
