import { CLIPBOARD_IMAGE_MAX_SOURCE_BYTES } from '../../../src/shared/clipboard-image'
import { formatVideoFrameSizeLabel } from './mobile-video-frame-extractor'
import {
  isPendingNativeChatFile,
  stripMobileNativeChatFileNotes,
  withMobileNativeChatFileNotes
} from './mobile-native-chat-file-attachment'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'

/**
 * The note for a group of frames pulled from an over-the-cap video — the
 * chat's counterpart of `mobile-native-chat-file-attachment.ts`'s file note,
 * for attachments that ride as images (`kind` stays "image") rather than a
 * named file, and are described in text instead.
 */

const UPLOAD_CAP_LABEL = formatVideoFrameSizeLabel(CLIPBOARD_IMAGE_MAX_SOURCE_BYTES)

export function isPendingNativeChatVideoFrame(attachment: PendingNativeChatImage): boolean {
  return attachment.videoFrame !== undefined
}

/** One line per distinct video (by `groupId`). The frame count is how many
 *  of that group are actually in `attachments` right now — not the planned
 *  total each frame's own metadata still carries — so a group a cancel or a
 *  failed upload left short of its plan is described as it really is
 *  (2026-09-27 review: the note used to repeat the plan regardless). The
 *  cadence and duration describe the source video itself and stay as
 *  sampled, whatever the survivor count. */
export function buildMobileNativeChatVideoFrameNotes(
  attachments: readonly PendingNativeChatImage[]
): string {
  const actualTotalByGroup = new Map<string, number>()
  for (const attachment of attachments) {
    const groupId = attachment.videoFrame?.groupId
    if (groupId) {
      actualTotalByGroup.set(groupId, (actualTotalByGroup.get(groupId) ?? 0) + 1)
    }
  }
  const seen = new Set<string>()
  const lines: string[] = []
  for (const attachment of attachments) {
    const meta = attachment.videoFrame
    if (!meta || seen.has(meta.groupId)) {
      continue
    }
    seen.add(meta.groupId)
    const total = actualTotalByGroup.get(meta.groupId) ?? meta.total
    const frameWord = total === 1 ? 'frame' : 'frames'
    const cadence = meta.intervalLabel ? `, ${meta.intervalLabel}` : ''
    lines.push(
      `Frames from ${meta.sourceName} (${meta.durationLabel}, ${total} ${frameWord}${cadence}). ` +
        `The video itself is ${meta.sourceSizeLabel}, over the ${UPLOAD_CAP_LABEL} the desktop accepts, so it was not sent.`
    )
  }
  return lines.join('\n')
}

/** Prepend the video-frame notes to the user's text; a bare frame group still sends. */
export function withMobileNativeChatVideoFrameNotes(
  text: string,
  attachments: readonly PendingNativeChatImage[]
): string {
  const notes = buildMobileNativeChatVideoFrameNotes(attachments)
  if (!notes) {
    return text
  }
  const body = text.trim()
  return body ? `${notes}\n\n${body}` : notes
}

const FRAME_NOTE_LINE = /^Frames from .* so it was not sent\.$/

/** The user's own text out of a sent body `withMobileNativeChatVideoFrameNotes`
 *  built, mirroring `stripMobileNativeChatFileNotes`. Unchanged when no note leads. */
export function stripMobileNativeChatVideoFrameNotes(text: string): string {
  const lines = text.split('\n')
  let count = 0
  while (count < lines.length && FRAME_NOTE_LINE.test(lines[count] as string)) {
    count += 1
  }
  if (count === 0) {
    return text
  }
  const rest = lines.slice(count)
  if (rest.length === 0) {
    return ''
  }
  return rest[0] === '' ? rest.slice(1).join('\n') : rest.join('\n')
}

/** Both note kinds together, frame notes outermost: `withMobileNativeChatFileNotes`
 *  already wraps `text` for any file attachments, and this wraps that with the
 *  frame notes, so a mixed send reads frames, then files, then the user's text. */
export function withMobileNativeChatAttachmentNotes(
  text: string,
  attachments: readonly PendingNativeChatImage[]
): string {
  return withMobileNativeChatVideoFrameNotes(
    withMobileNativeChatFileNotes(text, attachments.filter(isPendingNativeChatFile)),
    attachments
  )
}

/** The inverse of `withMobileNativeChatAttachmentNotes`: peel the frame notes
 *  first (they are outermost), then the file notes. */
export function stripMobileNativeChatAttachmentNotes(text: string): string {
  return stripMobileNativeChatFileNotes(stripMobileNativeChatVideoFrameNotes(text))
}
