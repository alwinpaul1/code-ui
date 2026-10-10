import { isImageRefBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import { carriesPhoto, containsGluedSegment, pastedPhotos, photoNames, photoSlots, placedByName, rowWillNamePastedPhotos, canBeEarlySendRow, writtenBefore } from './mobile-native-chat-photo-rows'
import { foldQueuedImageTurns, trailingCompanionOwner } from './mobile-native-chat-queued-image-fold'
import {
  hasImagePromptMarker,
  isImageSourceUserTurn,
  normalizeImageTranscriptMessages,
  normalizeNativeChatUserText,
  normalizedNativeChatUserMessageText
} from './mobile-native-chat-image-transcript-markers'
export { normalizeNativeChatUserText as normalizeReconcileText } from './mobile-native-chat-image-transcript-markers'

/** An ack-lost ('unknown' outcome) send held until its transcript echo lands or
 *  the deadline surfaces the uncertainty. */
export type UnconfirmedSend = {
  draftKey: string
  pendingKey: string | null
  text: string
  normalizedText: string
  baselineTailMessageId: string | null
  deadline: ReturnType<typeof setTimeout> | null
  /** Prompt-receipt nonces the agent had already reported when this send left
   *  the phone. The beacon carries an accumulated history (up to 40, persisted
   *  across launches), so without this a receipt from hours ago confirms a send
   *  that never arrived and silently cancels its "Delivery unconfirmed" notice. */
  knownReceiptNonces?: ReadonlySet<string>
  /** The outbox entry the send is written under, retired when it lands. */
  outboxId?: string
}

export function normalizedUserText(message: NativeChatMessage): string | null {
  return normalizedNativeChatUserMessageText(message)
}

export function countUserTextOccurrences(
  messages: readonly NativeChatMessage[],
  text: string
): number {
  let count = 0
  for (const message of messages) {
    if (normalizedUserText(message) === text) {
      count++
    }
  }
  return count
}

/** Number of `[Image: source: …]` echo turns strictly after `tailId` (or the
 *  whole transcript when the tail was paginated out). An image-only send has no
 *  caption to match, so it reconciles by ordinal against this count — counting
 *  only image echoes keeps an unrelated text send's echo from clearing it. */
export function countImageSourceTurnsAfter(
  messages: readonly NativeChatMessage[],
  tailId: string | null
): number {
  const tailIndex = tailId ? messages.findIndex((message) => message.id === tailId) : -1
  let count = 0
  for (let i = tailIndex + 1; i < messages.length; i++) {
    const message = messages[i]
    if (message && isImageSourceUserTurn(message)) {
      count++
    }
  }
  return count
}

export type PendingImagePreviewEcho = {
  id: string
  text: string
  images?: string[]
  expectedOccurrence: number
  baselineTailMessageId: string | null
  /** When the phone sent it, by the phone's clock (absent from older builds). */
  sentAt?: number
  /** Sent before the chat's read settled, so its tail is not to be trusted. */
  sentBeforeReadSettled?: boolean
  settledTailId?: string | null
  settledWrittenBeforeId?: string | null
  /** The desktop paths the send pasted, one per preview in `images`. */
  imagePaths?: string[]
  /** False for a send whose tail was never resolved against this chat's
   *  read: only the path rule binds it, since the others go by that tail. */
  baselineResolved?: boolean
  /** When the agent took it out of its queue box (isTakenSend): it may get
   *  no row at all. */
  takenAt?: number
}

const NO_BOUND: Readonly<Record<string, readonly string[]>> = {}

export type LandedImagePreviewEcho = {
  pendingId: string
  messageId: string
  images: string[]
}

const SENT_IMAGE_PREVIEW_LIMIT = 32
const SENT_IMAGE_PREVIEW_SESSION_LIMIT = 8

export function mergeLandedImagePreviewEchoes(
  previous: Record<string, Record<string, string[]>>,
  sessionKey: string,
  landed: readonly LandedImagePreviewEcho[]
): Record<string, Record<string, string[]>> {
  const entries = Object.entries(previous[sessionKey] ?? {})
  for (const preview of landed) {
    const existingIndex = entries.findIndex(([messageId]) => messageId === preview.messageId)
    if (existingIndex !== -1) {
      entries.splice(existingIndex, 1)
    }
    entries.push([preview.messageId, preview.images])
  }
  const next = { ...previous }
  delete next[sessionKey]
  next[sessionKey] = Object.fromEntries(entries.slice(-SENT_IMAGE_PREVIEW_LIMIT))
  for (const key of Object.keys(next).slice(0, -SENT_IMAGE_PREVIEW_SESSION_LIMIT)) {
    delete next[key]
  }
  return next
}

function imagePreviewReplacementMessageId(
  messages: readonly NativeChatMessage[],
  sourceIndex: number
): string | null {
  const source = messages[sourceIndex]
  if (!source || !isImageSourceUserTurn(source)) {
    return null
  }
  // From Claude Code 2.1.228 a companion follows its prompt: the prompt right
  // before the run owns it, as the chat draws it (trailingCompanionOwner).
  // A run bound on its own at the window's start went forward to the next
  // message once the page above it loaded (third review, 2026-09-26).
  const owner = trailingCompanionOwner(messages, sourceIndex, source)
  if (owner) {
    return owner.id
  }
  let nextIndex = sourceIndex + 1
  while (
    messages[nextIndex]?.source === source.source &&
    isImageSourceUserTurn(messages[nextIndex]!)
  ) {
    nextIndex++
  }
  const prompt = messages[nextIndex]
  // At the start of the window, a prompt with a companion of its own right
  // after it is another message: this run trails the prompt before the
  // window, as the chat draws it (keepWindowStartRun), and moved here it gave
  // that prompt the first message's photos (review of becd6af2). Anywhere
  // else the older order (companion before its prompt, Claude Code before
  // 2.1.228) moves it as before (re-review of 4e25d63e).
  const after = messages[nextIndex + 1]
  if (sourceIndex === 0 && after?.source === source.source && isImageSourceUserTurn(after)) {
    return null
  }
  return prompt?.role === 'user' && prompt.source === source.source && hasImagePromptMarker(prompt)
    ? prompt.id
    : null
}

/** Moves previews forward when a progressive source-only transcript frame later
 *  folds into the marker-bearing prompt with a different authoritative id. */
export function migrateImagePreviewMessageIds(
  previous: Record<string, Record<string, string[]>>,
  sessionKey: string,
  messages: readonly NativeChatMessage[]
): Record<string, Record<string, string[]>> {
  const sessionPreviews = previous[sessionKey]
  if (!sessionPreviews) {
    return previous
  }
  const messageIndexById = new Map(messages.map((message, index) => [message.id, index]))
  let nextSession: Record<string, string[]> | null = null
  for (const [messageId, images] of Object.entries(sessionPreviews)) {
    const sourceIndex = messageIndexById.get(messageId)
    if (sourceIndex === undefined) {
      continue
    }
    const replacementId = imagePreviewReplacementMessageId(messages, sourceIndex)
    if (!replacementId) {
      continue
    }
    nextSession ??= { ...sessionPreviews }
    delete nextSession[messageId]
    nextSession[replacementId] = [...(nextSession[replacementId] ?? []), ...images]
  }
  return nextSession ? { ...previous, [sessionKey]: nextSession } : previous
}

/** Binds local preview URIs to the authoritative transcript turn that replaced
 *  the optimistic bubble. Host paths and marker-only Codex turns cannot render
 *  the phone-local photo without this handoff. */
export function findLandedImagePreviewEchoes(
  messages: readonly NativeChatMessage[],
  entries: readonly PendingImagePreviewEcho[],
  /** The phone's photos rows already draw, from sends that retired. */
  bound: Readonly<Record<string, readonly string[]>> = NO_BOUND,
  now = Date.now()
): LandedImagePreviewEcho[] {
  const normalized = normalizeImageTranscriptMessages(messages)
  const messageIndexById = new Map(normalized.map((message, index) => [message.id, index]))
  const rawById = new Map(messages.map((message) => [message.id, message]))
  // Keep provenance from the raw transcript: normalization removes image markers,
  // so a plain text row must not become a candidate merely because it shares a
  // caption prefix with a glued image send.
  const imageMessageIds = new Set(
    [...messages, ...normalized]
      .filter(
        (message) =>
          message.role === 'user' &&
          (isImageSourceUserTurn(message) ||
            hasImagePromptMarker(message) ||
            message.blocks.some(isImageRefBlock))
      )
      .map((message) => message.id)
  )
  // A baseline id names the newest row that already existed when the photo was
  // sent. Claude writes the "[Image: source: …]" companion AFTER the prompt and
  // normalization folds it away, so that id is missing from the index above —
  // and a missing id read as "no baseline" turned both later guards off and let
  // the echo bind to the older photo's own turn. Resolve a folded-away row to
  // the last surviving row at or before it; leave a row that is not in this
  // window at all unresolved, which still means "no constraint".
  const resolvedTailIndexByRawId = new Map<string, number>()
  let lastSurviving = -1
  for (const message of messages) {
    const index = messageIndexById.get(message.id)
    if (index !== undefined) {
      lastSurviving = index
    }
    resolvedTailIndexByRawId.set(message.id, lastSurviving)
  }
  const indexOf = (id: string) => messageIndexById.get(id) ?? resolvedTailIndexByRawId.get(id)
  // The phone's photos each row draws, from earlier sends and this pass. A
  // row with as many as it has photos is another send's; one with room left
  // is a row two sends were glued into, and the next one's photos go after
  // the first's (review, 2026-09-26: refusing it left the second send's
  // bubble standing for good). Glue is told by the words, so a photo with no
  // words takes only a row that draws none yet: one with room left because
  // its own send had fewer photos than it names is still that send's.
  const drawn = new Map<string, readonly string[]>()
  const drawnOn = (id: string) => drawn.get(id) ?? bound[id] ?? []
  const newestStamp = messages.reduce<number | null>(
    (newest, message) => (message.timestamp !== null && (newest === null || message.timestamp > newest) ? message.timestamp : newest),
    null
  )
  const landed: LandedImagePreviewEcho[] = []
  // Claude Code and Codex name each photo a row carries by the path that was
  // pasted, and the phone knows the paths it pasted: a row naming one of them
  // is that send's, wherever it sits and whatever its stamp, and a row naming
  // only others is not. The rules below guess only among rows that name no
  // photo yet: a prompt row whose companion has not landed, or a host whose
  // rows never name one. The path rule reads the rows as the chat draws them:
  // a companion the loaded window starts with stays on its own there
  // (foldQueuedImageTurns), and folded into the next prompt it gave that
  // prompt the first message's photos (review of becd6af2).
  const drawnRows = normalizeImageTranscriptMessages(foldQueuedImageTurns([...messages]))

  for (const entry of entries) {
    if (!entry.images?.length) {
      continue
    }
    const pasted = pastedPhotos(entry)
    if (pasted) {
      const own = drawnRows.find(
        (message) => message.role === 'user' && photoNames(message).some((name) => pasted.has(name))
      )
      if (own) {
        const images = placedByName(own, pasted, drawnOn(own.id))
        drawn.set(own.id, images)
        landed.push({ pendingId: entry.id, messageId: own.id, images })
        continue
      }
    }
    if (entry.baselineResolved === false) {
      continue
    }
    const targetText = normalizeNativeChatUserText(entry.text)
    const full = (message: NativeChatMessage) =>
      targetText
        ? drawnOn(message.id).length >= photoSlots(message, rawById.get(message.id))
        : drawnOn(message.id).length > 0
    const candidates = normalized.filter((message) => {
      if (message.role !== 'user' || writtenBefore(message, entry, newestStamp, now)) {
        return false
      }
      // It names photos and none of this send's: another message's row
      // (2026-09-26, Claude Code 2.1.283: an older photo row took a photo
      // sent with no words, and the send's own row drew "Image on Desktop").
      if (pasted && photoNames(message).length > 0) {
        return false
      }
      // A row with no photo in it is not the row of a photo send the agent
      // took mid-turn, which gets none, whatever its words (review of
      // becd6af2: it went to a later "yes" sent alone). Nor is it the row of
      // one sent before the read settled whose row will name its paths when
      // that read already held the row: an older row of its words took it
      // after a quiet minute (fourth review). A send's own row can carry
      // none, its photo failed to attach, and still shows as the phone's
      // (re-review of 4e25d63e; fifth review for an early send). Told by the
      // read, not a clock: the phone's against the desk's let an older row
      // take the photo (sixth review).
      const heldForItsRow = entry.sentBeforeReadSettled === true && rowWillNamePastedPhotos(entry)
      if (pasted && !carriesPhoto(message, rawById.get(message.id))) {
        if (typeof entry.takenAt === 'number' || (heldForItsRow && !canBeEarlySendRow(message, messageIndexById.get(message.id), entry, indexOf))) {
          return false
        }
      }
      if (targetText) {
        const text = normalizedUserText(message)
        if (text === null) {
          return false
        }
        // Why not equality alone: a send is glued onto the agent's input line with any
        // send adjacent to it, so an image send that shares a turn with another send
        // lands in a row whose text is the concatenation. Requiring the whole row to
        // equal this echo left it unmatched, and since both other retirement paths
        // skip image echoes, nothing could ever retire it. The image send can sit
        // anywhere in the glue (a text-only send queued first, the photo after it
        // — seen 2026-09-06 on 0.2.18), so match it as a whole-word segment.
        return (
          text === targetText ||
          (imageMessageIds.has(message.id) && containsGluedSegment(text, targetText))
        )
      }
      const imageCount = message.blocks.filter(isImageRefBlock).length
      return message.blocks.length === 0 || imageCount >= entry.images!.length
    })
    const tailIndex = entry.baselineTailMessageId
      ? (messageIndexById.get(entry.baselineTailMessageId) ??
        resolvedTailIndexByRawId.get(entry.baselineTailMessageId))
      : -1
    const afterTail = (message: NativeChatMessage) =>
      tailIndex === undefined || (messageIndexById.get(message.id) ?? -1) > tailIndex
    const occurrenceIndex = Math.max(0, entry.expectedOccurrence - 1)
    // A photo with no words has only the order of photo rows to go by: the
    // first after its tail that does not already draw another send's photos.
    // Counting photo rows by the send's ordinal counted the rows of sends that
    // had retired meanwhile too, so skipping the drawn ones could not use it.
    const candidate =
      !targetText || (tailIndex !== undefined && tailIndex >= 0)
        ? // The saved ordinal counted a larger transcript. A retained baseline
          // is stronger evidence: use the next unclaimed echo after that send.
          candidates.find((message) => afterTail(message) && !full(message))
        : candidates[occurrenceIndex]
    if (!candidate || full(candidate) || !afterTail(candidate)) {
      continue
    }
    const images = [...drawnOn(candidate.id), ...entry.images]
    drawn.set(candidate.id, images)
    landed.push({ pendingId: entry.id, messageId: candidate.id, images })
  }
  return landed
}


export function findLandedUnconfirmedSends(
  messages: readonly NativeChatMessage[],
  entries: readonly UnconfirmedSend[]
): UnconfirmedSend[] {
  // Why: pagination prepends old equal text; only unclaimed matches after each
  // captured tail prove new echoes. User turns are keyed by text; an image echo
  // (`[Image: source: …]` or no text) keys under '' so an empty-text send can
  // claim it.
  const messageIndexById = new Map<string, number>()
  const userMessagesByText = new Map<string, Array<{ id: string; index: number }>>()
  for (const [index, message] of messages.entries()) {
    messageIndexById.set(message.id, index)
    if (message.role !== 'user') {
      continue
    }
    const key = isImageSourceUserTurn(message) ? '' : (normalizedUserText(message) ?? '')
    const current = userMessagesByText.get(key) ?? []
    current.push({ id: message.id, index })
    userMessagesByText.set(key, current)
  }

  const claimedMessageIds = new Set<string>()
  const landed: UnconfirmedSend[] = []
  for (const entry of entries) {
    const tailIndex = entry.baselineTailMessageId
      ? messageIndexById.get(entry.baselineTailMessageId)
      : -1
    if (tailIndex === undefined) {
      continue
    }
    const echo = userMessagesByText
      .get(entry.normalizedText)
      ?.find((message) => message.index > tailIndex && !claimedMessageIds.has(message.id))
    if (echo) {
      claimedMessageIds.add(echo.id)
      landed.push(entry)
    }
  }
  return landed
}

/** Whether the text that went out is the draft still in the box. Compared
 *  trimmed as well as exactly: a file rides ahead of the message as a note
 *  built from the TRIMMED draft, so one trailing space from the keyboard left
 *  the two unequal and the words stayed in the composer (2026-09-13). */
export function draftWasSent(held: string, sent: string): boolean {
  return held === sent || held.trim() === sent.trim()
}
