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
      if (!scope || !client) {
        return
      }
      let uploaded: Awaited<ReturnType<typeof uploadMarkedUpNativeChatImage>>
      try {
        uploaded = await uploadMarkedUpNativeChatImage(base64, {
          client,
          getConnectionId: getActiveWorktreeConnectionId
        })
      } catch {
        // Never throws: the editor has closed by Done and voids this promise,
        // so a rejection reached no one, and the unmarked photo then went out
        // as if it had been marked up (2026-09-25 sweep).
        showToast('Markup not saved — the photo is still attached without it', 1500)
        return
      }
      replaceAttachmentImage(scope, id, uploaded)
    },
    [client, getActiveWorktreeConnectionId, scopeKey, replaceAttachmentImage, showToast]
  )
}
