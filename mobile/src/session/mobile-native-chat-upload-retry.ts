import {
  refailNativeChatImage,
  replaceNativeChatImageAttachment,
  retryFailedNativeChatImage
} from './mobile-native-chat-image-attachment'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { withScopeAttachments } from './mobile-native-chat-image-scope-state'

/**
 * How a chip whose upload failed goes up again (2026-10-11). A failed upload used to take its
 * chip away with a toast, so the only way back was to find the photo in the picker again. The
 * chip now stays, failed, and its retry is kept here by chip id: chip ids are unique across the
 * app (`nativeChatChipIdCounter`), and the chip strip can reach this without a prop through
 * every composer layer.
 */
type NativeChatUploadRetry = {
  readonly scope: string
  readonly run: () => Promise<{ path: string; previewUri: string }>
  readonly onFailed: (error: unknown) => void
}

const retries = new Map<string, NativeChatUploadRetry>()

export function registerNativeChatUploadRetry(id: string, retry: NativeChatUploadRetry): void {
  retries.set(id, retry)
}

export function forgetNativeChatUploadRetry(id: string): void {
  retries.delete(id)
}

export function canRetryNativeChatUpload(id: string): boolean {
  return retries.has(id)
}

export function resetNativeChatUploadRetriesForTests(): void {
  retries.clear()
}

/**
 * Sends a failed chip's picture again. The chip is drawn uploading while it goes, settles with
 * the host path when it lands, and goes back to failed, with the retry's own toast, when it does
 * not. A chip that has been removed, sent, or is not failed any more is left alone and answers
 * false.
 */
export async function retryNativeChatUpload(id: string): Promise<boolean> {
  const retry = retries.get(id)
  if (!retry) {
    return false
  }
  const store = useNativeChatImageAttachmentsStore.getState()
  const retrying = retryFailedNativeChatImage(store.byScope[retry.scope] ?? [], id)
  if (!retrying) {
    retries.delete(id)
    return false
  }
  store.update((prev) => withScopeAttachments(prev, retry.scope, retrying))
  try {
    const landed = await retry.run()
    retries.delete(id)
    useNativeChatImageAttachmentsStore
      .getState()
      .update((prev) =>
        withScopeAttachments(
          prev,
          retry.scope,
          replaceNativeChatImageAttachment(prev[retry.scope] ?? [], id, landed)
        )
      )
    return true
  } catch (error) {
    useNativeChatImageAttachmentsStore
      .getState()
      .update((prev) =>
        withScopeAttachments(prev, retry.scope, refailNativeChatImage(prev[retry.scope] ?? [], id))
      )
    retry.onFailed(error)
    return false
  }
}
