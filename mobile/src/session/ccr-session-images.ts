import type { CcrEvent } from './ccr-session-api'

/**
 * The pictures in a Claude Code session's API events, as `data:` URIs.
 *
 * An event's `payload` is the session's message as the transcript holds it
 * (verified against this machine's transcript of Claude Code 2.1.296,
 * session 211c47c2, 2026-10-14; the app's parser reads the same block kinds,
 * rkt.java:18-33):
 *  - an image the agent Read comes back in the next `user` message as
 *    `{type: "tool_result", tool_use_id, content: [{type: "image", source:
 *    {type: "base64", media_type, data}}]}` (the app's mnt/knt.java, image
 *    lkt.java with ImageSource qih.java);
 *  - an image the user pasted is a top-level `{type: "image", source: …}` in
 *    that user message's own content, beside the `[Image #N]` text.
 *
 * Nothing is guessed: a block that is not that shape is skipped and counted
 * with its reason, and the caller says so in its one log line.
 */

export const CCR_IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

export type CcrImageSkip = 'oversize' | 'malformed' | 'unsupported-type'

export type CcrImageOutcome = { uri: string } | { skip: CcrImageSkip }

/** Decoded size of a base64 string, without decoding it. */
export function base64ByteLength(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return (data.length / 4) * 3 - padding
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** One `image` block as a `data:` URI, or why not. */
export function ccrImageDataUri(block: unknown, maxBytes: number): CcrImageOutcome {
  const source = record(record(block)?.source)
  if (!source || source.type !== 'base64' || typeof source.data !== 'string' || typeof source.media_type !== 'string') {
    return { skip: 'malformed' }
  }
  const mediaType = source.media_type.toLowerCase()
  if (!CCR_IMAGE_MEDIA_TYPES.has(mediaType)) {
    return { skip: 'unsupported-type' }
  }
  const data = source.data
  if (data.length === 0 || data.length % 4 !== 0 || !BASE64.test(data)) {
    return { skip: 'malformed' }
  }
  if (base64ByteLength(data) > maxBytes) {
    return { skip: 'oversize' }
  }
  return { uri: `data:${mediaType};base64,${data}` }
}

/** Every `image` block under a tool result's content, in order: a list of
 *  blocks, and any `content` list nested in one of them. A string content
 *  holds no picture. */
function imagesUnder(content: unknown, out: unknown[], depth = 0): void {
  if (depth > 4 || !Array.isArray(content)) {
    return
  }
  for (const item of content) {
    if (Array.isArray(item)) {
      imagesUnder(item, out, depth + 1)
      continue
    }
    const block = record(item)
    if (!block) {
      continue
    }
    if (block.type === 'image') {
      out.push(block)
    } else if (Array.isArray(block.content)) {
      imagesUnder(block.content, out, depth + 1)
    }
  }
}

export type CcrWantedImages = {
  /** `toolu_…` ids of the Reads whose pictures are wanted. */
  toolUseIds: ReadonlySet<string>
  /** Transcript uuids of the user messages whose pasted pictures are wanted. */
  userMessageIds: ReadonlySet<string>
}

export type CcrExtracted = {
  /** A Read's picture (its first image). */
  byToolUseId: Map<string, string>
  /** A user message's pasted pictures, in order. */
  byUserMessageId: Map<string, string[]>
  /** Wanted ids the events held with no usable picture, and why. */
  skipped: Map<string, CcrImageSkip | 'no-image-in-event'>
  /** Every message uuid the events carried (for matching a tab). */
  uuids: Set<string>
}

export function emptyCcrExtracted(): CcrExtracted {
  return { byToolUseId: new Map(), byUserMessageId: new Map(), skipped: new Map(), uuids: new Set() }
}

/** The uuid an event's message carries, if any. */
export function ccrEventUuid(event: CcrEvent): string | null {
  const uuid = event.payload.uuid
  return typeof uuid === 'string' && uuid.length > 0 ? uuid : null
}

function contentOf(event: CcrEvent): unknown[] | null {
  if (event.payload.type !== 'user') {
    return null
  }
  const content = record(event.payload.message)?.content
  return Array.isArray(content) ? content : null
}

function firstUri(blocks: unknown[], maxBytes: number): { uri?: string; skip?: CcrImageSkip } {
  let skip: CcrImageSkip | undefined
  for (const block of blocks) {
    const outcome = ccrImageDataUri(block, maxBytes)
    if ('uri' in outcome) {
      return { uri: outcome.uri }
    }
    skip ??= outcome.skip
  }
  return { skip }
}

/** Takes the wanted pictures out of `events` into `into` (which also gathers
 *  the events' uuids). A picture found once is kept; a later event does not
 *  replace it. */
export function extractCcrImages(
  events: readonly CcrEvent[],
  wanted: CcrWantedImages,
  maxBytes: number,
  into: CcrExtracted = emptyCcrExtracted()
): CcrExtracted {
  for (const event of events) {
    const uuid = ccrEventUuid(event)
    if (uuid) {
      into.uuids.add(uuid)
    }
    const content = contentOf(event)
    if (!content) {
      continue
    }
    if (uuid && wanted.userMessageIds.has(uuid) && !into.byUserMessageId.has(uuid)) {
      const pasted = content.filter((block) => record(block)?.type === 'image')
      if (pasted.length === 0) {
        into.skipped.set(uuid, 'no-image-in-event')
      } else {
        const uris: string[] = []
        let skip: CcrImageSkip | undefined
        for (const block of pasted) {
          const outcome = ccrImageDataUri(block, maxBytes)
          if ('uri' in outcome) {
            uris.push(outcome.uri)
          } else {
            // Kept in its place so the next picture keeps its own slot; the
            // slot stays the chip it was.
            uris.push('')
            skip ??= outcome.skip
          }
        }
        if (uris.some((uri) => uri.length > 0)) {
          into.byUserMessageId.set(uuid, uris)
          into.skipped.delete(uuid)
        } else {
          into.skipped.set(uuid, skip ?? 'malformed')
        }
      }
    }
    for (const item of content) {
      const block = record(item)
      if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string') {
        continue
      }
      const id = block.tool_use_id
      if (!wanted.toolUseIds.has(id) || into.byToolUseId.has(id)) {
        continue
      }
      const images: unknown[] = []
      imagesUnder(block.content, images)
      if (images.length === 0) {
        into.skipped.set(id, 'no-image-in-event')
        continue
      }
      const { uri, skip } = firstUri(images, maxBytes)
      if (uri) {
        into.byToolUseId.set(id, uri)
        into.skipped.delete(id)
      } else {
        into.skipped.set(id, skip ?? 'malformed')
      }
    }
  }
  return into
}
