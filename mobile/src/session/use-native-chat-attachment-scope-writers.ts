import { useCallback, useRef } from 'react'
import {
  addUploadingNativeChatImage,
  appendPendingNativeChatImages,
  dropUploadingNativeChatImages,
  replaceNativeChatImageAttachment,
  type PendingNativeChatImage,
  type UploadingNativeChatImage
} from './mobile-native-chat-image-attachment'
import { withScopeAttachments } from './mobile-native-chat-image-scope-state'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'

/** The writes an upload makes to a tab's chip strip: a chip when a file is
 *  picked, the finished upload into that chip, and the sweep of chips whose
 *  upload never finished. Split from the attachments hook for its line ceiling. */
export function useNativeChatAttachmentScopeWriters() {
  const setAttachmentsByScope = useNativeChatImageAttachmentsStore((state) => state.update)
  const idCounter = useRef(0)
  const addUploadedImages = useCallback(
    (scope: string, uploadedImages: Omit<PendingNativeChatImage, 'id'>[]) => {
      setAttachmentsByScope((prev) => ({
        ...prev,
        [scope]: appendPendingNativeChatImages(prev[scope] ?? [], uploadedImages, idCounter)
      }))
    },
    [setAttachmentsByScope]
  )
  const addUploadingImage = useCallback(
    (scope: string, image: UploadingNativeChatImage) => {
      setAttachmentsByScope((prev) => ({
        ...prev,
        [scope]: addUploadingNativeChatImage(prev[scope] ?? [], image, idCounter)
      }))
    },
    [setAttachmentsByScope]
  )
  const settleUploads = useCallback(
    (scope: string, batch?: string) => {
      setAttachmentsByScope((prev) =>
        withScopeAttachments(prev, scope, dropUploadingNativeChatImages(prev[scope] ?? [], batch))
      )
    },
    [setAttachmentsByScope]
  )
  // The markup editor's Done: swaps one chip's bytes for a marked-up version
  // once the re-upload finishes (use-mobile-native-chat-image-markup.ts owns
  // the upload itself, split out for the same reason this file is).
  const replaceAttachmentImage = useCallback(
    (
      scope: string,
      id: string,
      next: { path: string; previewUri: string; contentFingerprint?: string }
    ) => {
      setAttachmentsByScope((prev) =>
        withScopeAttachments(prev, scope, replaceNativeChatImageAttachment(prev[scope] ?? [], id, next))
      )
    },
    [setAttachmentsByScope]
  )
  return {
    setAttachmentsByScope,
    addUploadedImages,
    addUploadingImage,
    settleUploads,
    replaceAttachmentImage
  }
}
