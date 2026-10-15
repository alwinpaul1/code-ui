import {
  refailNativeChatImage,
  replaceNativeChatImageAttachment,
  retryFailedNativeChatImage,
  type NativeChatUploadLanded
} from './mobile-native-chat-image-attachment'
import {
  nativeChatAttachmentsResets,
  useNativeChatImageAttachmentsStore
} from './mobile-native-chat-image-attachments-store'
import { withScopeAttachments } from './mobile-native-chat-image-scope-state'
import { discardCcrUploadedFile } from './ccr-file-discard'
import { CcrFileUploadError } from './ccr-file-upload'

/**
 * How a chip whose upload failed goes up again (2026-10-11). A failed upload used to take its
 * chip away with a toast, so the only way back was to find the photo in the picker again. The
 * chip now stays, failed, and its retry is kept here by chip id: chip ids are unique across the
 * app (`nativeChatChipIdCounter`), and the chip strip can reach this without a prop through
 * every composer layer.
 */
type NativeChatUploadRetry = {
  readonly scope: string
  readonly run: (signal?: AbortSignal) => Promise<NativeChatUploadLanded>
  readonly onFailed: (error: unknown) => void
}

// Each retry holds its picture's bytes (a document's are inline, up to the 18 MB cap), so a
// store reset, which reuses chip ids from 1, must let go of them (Opus review, 2026-10-12).
// The store cannot import this module (it is imported by it), so a retry records the reset
// count it was made under and one from before the latest reset is dropped on sight.
const retries = new Map<string, NativeChatUploadRetry & { readonly resets: number }>()
/** A retry on its way up, by chip id: the remove badge (forget) calls it back. */
const retryUploads = new Map<string, AbortController>()

function pruneRetriesFromBeforeReset(): void {
  for (const [id, retry] of retries) {
    if (retry.resets !== nativeChatAttachmentsResets.current) {
      retries.delete(id)
    }
  }
}

export function registerNativeChatUploadRetry(id: string, retry: NativeChatUploadRetry): void {
  pruneRetriesFromBeforeReset()
  retries.set(id, { ...retry, resets: nativeChatAttachmentsResets.current })
}

export function forgetNativeChatUploadRetry(id: string): void {
  retries.delete(id)
  retryUploads.get(id)?.abort()
  retryUploads.delete(id)
}

export function canRetryNativeChatUpload(id: string): boolean {
  pruneRetriesFromBeforeReset()
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
  pruneRetriesFromBeforeReset()
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
  const upload = new AbortController()
  retryUploads.set(id, upload)
  try {
    const landed = await retry.run(upload.signal)
    if (retries.get(id) !== retry) {
      // Removed while it went up, and it landed anyway: nothing will reference its file.
      void discardCcrUploadedFile(landed.anthropicFile)
      return false
    }
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
    // Removed while it went up again (the badge shows over the ring): nothing to say. Refused as
    // too large (HTTP 413): no retry can help, so the chip goes, with the app's words.
    const stillWanted = retries.get(id) === retry
    const refused = error instanceof CcrFileUploadError && error.refusedBeforeUpload
    if (refused) {
      retries.delete(id)
    }
    useNativeChatImageAttachmentsStore
      .getState()
      .update((prev) =>
        withScopeAttachments(prev, retry.scope, refused ? (prev[retry.scope] ?? []).filter((chip) => chip.id !== id) : refailNativeChatImage(prev[retry.scope] ?? [], id))
      )
    if (stillWanted) {
      retry.onFailed(error)
    }
    return false
  } finally {
    if (retryUploads.get(id) === upload) {
      retryUploads.delete(id)
    }
  }
}
