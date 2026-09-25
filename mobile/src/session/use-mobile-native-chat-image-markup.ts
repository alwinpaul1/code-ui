import { useCallback } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { uploadMarkedUpNativeChatImage } from './mobile-native-chat-image-attachment'

type Args = {
  readonly client: RpcClient | null
  readonly getActiveWorktreeConnectionId: () => Promise<string | null>
  readonly scopeKey: string | null
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
      let uploaded: Awaited<ReturnType<typeof uploadMarkedUpNativeChatImage>>
      try {
        uploaded = await uploadMarkedUpNativeChatImage(base64, {
          client,
          getConnectionId: getActiveWorktreeConnectionId
        })
      } catch {
        notSaved()
        return
      }
      replaceAttachmentImage(scope, id, uploaded)
    },
    [client, getActiveWorktreeConnectionId, scopeKey, replaceAttachmentImage, showToast]
  )
}
