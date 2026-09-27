import { CLIPBOARD_IMAGE_MAX_SOURCE_BYTES } from '../../../src/shared/clipboard-image'
import { formatVideoFrameDurationLabel, formatVideoFrameSizeLabel } from './mobile-video-frame-extractor'
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
 *  (2026-09-27 review: the note used to repeat the plan regardless). A group
 *  can also be short of its plan for a reason that has nothing to do with
 *  reading stopping early: every frame arrived, and the user removed one
 *  chip before sending. Only `meta.stoppedEarly` (true on the frames that DID
 *  survive a cancel or a failed upload, set in
 *  `use-mobile-native-chat-image-upload.ts`) says which happened — a bare
 *  frame-count shortfall is not proof by itself (2026-09-27 review: the note
 *  used to say "reading stopped early" whenever the count was short, even
 *  after a complete read). When it genuinely did stop early, the note states
 *  the span the survivors actually cover ("3 frames from the first 14 s of a
 *  2 min 14 s video") rather than the cadence and duration a complete read
 *  would state — those describe an even sampling of the WHOLE video, which a
 *  cut-short read never was. With only one survivor (or no cadence to begin
 *  with) there is no span worth stating either — "1 frame of a 2 min 14 s
 *  video" reads better than "1 frame from the first 0 s". */
export function buildMobileNativeChatVideoFrameNotes(
  attachments: readonly PendingNativeChatImage[]
): string {
  const actualByGroup = new Map<string, { count: number; maxIndex: number }>()
  for (const attachment of attachments) {
    const groupId = attachment.videoFrame?.groupId
    if (!groupId) {
      continue
    }
    const current = actualByGroup.get(groupId) ?? { count: 0, maxIndex: 0 }
    actualByGroup.set(groupId, {
      count: current.count + 1,
      maxIndex: Math.max(current.maxIndex, attachment.videoFrame!.index)
    })
  }
  const seen = new Set<string>()
  const lines: string[] = []
  for (const attachment of attachments) {
    const meta = attachment.videoFrame
    if (!meta || seen.has(meta.groupId)) {
      continue
    }
    seen.add(meta.groupId)
    const actual = actualByGroup.get(meta.groupId)
    const total = actual?.count ?? meta.total
    const frameWord = total === 1 ? 'frame' : 'frames'
    const short = total < meta.total
    if (short && meta.stoppedEarly) {
      const spanPhrase =
        meta.intervalMs !== null && actual!.maxIndex > 1
          ? ` from the first ${formatVideoFrameDurationLabel((actual!.maxIndex - 1) * meta.intervalMs)}`
          : ''
      lines.push(
        `Frames from ${meta.sourceName} (${total} ${frameWord}${spanPhrase} of a ${meta.durationLabel} video). ` +
          `The video itself is ${meta.sourceSizeLabel}, over the ${UPLOAD_CAP_LABEL} the desktop accepts, so it was not sent; reading stopped early.`
      )
      continue
    }
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

// Matches both endings buildMobileNativeChatVideoFrameNotes can produce: a
// complete read's plain "...so it was not sent." and a cut-short one's
// "...so it was not sent; reading stopped early."
const FRAME_NOTE_LINE = /^Frames from .* so it was not sent(?:; reading stopped early)?\.$/

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
