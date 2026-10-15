import { ccrFileAttachment } from './ccr-file-upload'
import type { CcrFileAttachment } from './ccr-send'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'

/**
 * Which of a Claude tab's chips one Anthropic send takes (ccr-file-upload.ts has the upload).
 * The Claude app (1.261009.20) keeps its Code-session chips in `u49` (`tj4`, states `sj4`:
 * uploading `rj4`, done `oj4(w7v)`, failed `pj4`, too large `qj4`). Its send references only `oj4`
 * chips (`su8`, `file_attachments`), and a failed or too-large chip disables Send (`u49.d()`,
 * `su8.T`). It clears every chip on send, so one still uploading is cancelled and lost; that one
 * part is not copied. Here, nothing is ever dropped without a word:
 *  - a chip still uploading holds the send back, with the words left in the composer;
 *  - a chip whose upload failed holds it back too, as in the app, until it is retried or removed;
 *  - a chip whose bytes went to the desktop (picked before the tab moved to this lane) refuses the
 *    send: its file is on the desktop, not at Anthropic, so there is nothing to reference;
 *  - a chip uploaded with another account than the session's refuses the send: the desktop reads
 *    the file with the session account's own sign-in, and another account's file is not its to read.
 * Pure, so the rules are tested without React.
 */

export const CCR_WAITING_FOR_UPLOADS = 'Waiting for attachments to upload'
export const CCR_ATTACHMENT_ON_DESKTOP = 'Message not sent: an attachment was put on the desktop, not uploaded to Anthropic. Remove it and attach it again.'
export const CCR_ATTACHMENT_OTHER_ACCOUNT = "Message not sent: an attachment was uploaded with another Anthropic account than this tab's session. Remove it and attach it again."
/** A failed chip blocks the send, as `u49.d()` does in the app; the app's own words for the chip
 *  are `ccr_upload_failed`, and Code UI's chip carries a retry the app's does not. */
export const CCR_ATTACHMENT_FAILED = 'Message not sent: an attachment didn’t upload. Tap it to try again, or remove it.'

export type CcrAttachmentSendPlan =
  | { readonly kind: 'refuse'; readonly message: string }
  | { readonly kind: 'nothing' }
  | {
      readonly kind: 'send'
      /** The `file_attachments` of the one event, in the strip's order. */
      readonly files: readonly CcrFileAttachment[]
      /** The chips this send takes out of the composer. */
      readonly sent: readonly PendingNativeChatImage[]
      /** The previews the sent bubble shows: the images among `sent`. */
      readonly previewUris: readonly string[]
    }

export function planCcrAttachmentSend(chips: readonly PendingNativeChatImage[], text: string, accountId: string): CcrAttachmentSendPlan {
  if (chips.some((chip) => chip.uploading)) {
    return { kind: 'refuse', message: CCR_WAITING_FOR_UPLOADS }
  }
  if (chips.some((chip) => chip.failed)) {
    return { kind: 'refuse', message: CCR_ATTACHMENT_FAILED }
  }
  if (chips.some((chip) => !chip.anthropicFile)) {
    return { kind: 'refuse', message: CCR_ATTACHMENT_ON_DESKTOP }
  }
  if (chips.some((chip) => chip.anthropicFile?.accountId !== accountId)) {
    return { kind: 'refuse', message: CCR_ATTACHMENT_OTHER_ACCOUNT }
  }
  if (text.trim() === '' && chips.length === 0) {
    return { kind: 'nothing' }
  }
  return {
    kind: 'send',
    files: chips.map((chip) => ccrFileAttachment(chip.anthropicFile!)),
    sent: chips,
    previewUris: chips.filter((chip) => chip.anthropicFile!.isImage).map((chip) => chip.previewUri)
  }
}

/** A chip whose file lives at Anthropic must never be pasted into a terminal: its `path` is empty.
 *  The desktop send refuses with this when the tab left the Anthropic lane after the pick. */
export const CCR_ATTACHMENT_NOT_ON_DESKTOP = 'Message not sent: an attachment was uploaded to Anthropic, but this tab now sends through the desktop. Remove it and attach it again.'

export function chipsHeldByAnthropic(chips: readonly PendingNativeChatImage[]): boolean {
  return chips.some((chip) => chip.anthropicFile !== undefined)
}
