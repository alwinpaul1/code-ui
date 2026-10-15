import type { NativeChatBlock, NativeChatMessage, NativeChatToolResultBlock } from '../../../src/shared/native-chat-types'
import type { CcrEvent } from './ccr-session-api'
import { joinAdjacentThoughts } from './ccr-thought-rows'
import { compactionCaption, readCompactionTokens } from './compaction-caption'
import { ccrImageDataUri, type CcrImageSkip } from './ccr-session-images'
import { AGENT_IMAGE_MAX_BYTES } from './host-image-size-cap'
import { ccrAttachmentBlock, type CcrAttachmentRef } from './mobile-native-chat-file-mentions'
import { isLocalCommandOutput, LOCAL_COMMAND_PRESENTATION, localCommandDrawnText } from './mobile-native-chat-local-command'

/**
 * A Claude Code session's Anthropic events as the chat's rows: the only transcript a matched
 * Claude tab shows (the user's decision of 2026-10-15, "stop reading from Orca and only from
 * Anthropic").
 *
 * The payloads are Claude Code's SDK messages (`type` user / assistant / system / result /
 * rate_limit_event / control_request / control_response, observed live 2026-10-14, 4,000
 * events); a `user`/`assistant` payload's `message` is the transcript record's message, so the
 * block rules are Orca's Claude decoder's (orca src/main/native-chat/
 * transcript-line-decoders-claude.ts and transcript-record-blocks.ts), with three differences
 * that only this source allows:
 *  - a tool call and its result carry their `toolu_…` id (`callId`), so a result pairs by id;
 *  - pictures are kept: each base64 `image` block goes to a cache file as the event arrives
 *    (`slimCcrEvent`), drawn from there; a user's pasted picture is an `image-ref` in its row, a
 *    Read's picture is kept under its call id for the Read row (ccr-session-cache.ts);
 *  - the row's time is the event's `created_at` (SDK messages carry no `timestamp`).
 *
 * What the Claude app 1.261009.20 draws for each other kind, and what is hidden, is in
 * scratchpad/plan/claude-transcript-inventory.md; the system kinds drawn here are the ones the
 * phone already has a row for.
 */

/** Writes a picture to a cache file; the file's URI, or null when it could not be kept. */
export type CcrImageKeeper = (key: string, dataUri: string) => string | null

/** A kept picture as it stands in a slim event, in place of the base64 source. */
type KeptImage = { type: 'image'; source: { type: 'kept'; uri: string } } | { type: 'image'; source: { type: 'kept-skip'; reason: CcrImageSkip | 'not-kept' } }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** The image cache key of a pasted picture and of a Read's, the same keys the image pipeline
 *  writes (ccr-session-pipeline.ts), so a picture fetched either way is one file. */
export function ccrUserImageKey(uuid: string, index: number): string {
  return `ccr\0user\0${uuid}\0${index}`
}
export function ccrToolImageKey(toolUseId: string, index: number): string {
  return index === 0 ? `ccr\0tool\0${toolUseId}` : `ccr\0tool\0${toolUseId}\0${index}`
}

function keepImage(block: unknown, key: string, keep: CcrImageKeeper): KeptImage {
  const outcome = ccrImageDataUri(block, AGENT_IMAGE_MAX_BYTES)
  if ('skip' in outcome) {
    return { type: 'image', source: { type: 'kept-skip', reason: outcome.skip } }
  }
  const uri = keep(key, outcome.uri)
  return uri ? { type: 'image', source: { type: 'kept', uri } } : { type: 'image', source: { type: 'kept-skip', reason: 'not-kept' } }
}

function isBase64Image(block: unknown): boolean {
  const source = record(record(block)?.source)
  return record(block)?.type === 'image' && source?.type === 'base64'
}

/**
 * The event with every base64 picture moved to a cache file: what the link holds in memory and
 * persists. An event with no picture comes back as it was.
 */
export function slimCcrEvent(event: CcrEvent, keep: CcrImageKeeper): CcrEvent {
  const payload = event.payload
  const message = record(payload.message)
  const content = message?.content
  const uuid = str(payload.uuid)
  if (payload.type !== 'user' || !Array.isArray(content) || !uuid || !JSON.stringify(content).includes('"base64"')) {
    return event
  }
  let userIndex = 0
  const slimmed = content.map((item) => {
    const block = record(item)
    if (!block) {
      return item
    }
    if (isBase64Image(block)) {
      return keepImage(block, ccrUserImageKey(uuid, userIndex++), keep)
    }
    if (block.type === 'tool_result' && Array.isArray(block.content)) {
      const toolUseId = str(block.tool_use_id) ?? uuid
      let toolIndex = 0
      return { ...block, content: block.content.map((inner) => (isBase64Image(inner) ? keepImage(inner, ccrToolImageKey(toolUseId, toolIndex++), keep) : inner)) }
    }
    return item
  })
  return { ...event, payload: { ...payload, message: { ...message, content: slimmed } } }
}

/** A kept picture's URI, or null (a picture over the cap or unreadable stays a chip). */
export function keptImageUri(block: unknown): string | null {
  const source = record(record(block)?.source)
  return source?.type === 'kept' && typeof source.uri === 'string' ? source.uri : null
}

/** The URIs of a tool result's kept pictures, in order. */
export function ccrToolResultImageUris(block: Record<string, unknown>): string[] {
  return Array.isArray(block.content) ? block.content.map(keptImageUri).filter((uri): uri is string => uri !== null) : []
}

// ─── Blocks ────────────────────────────────────────────────────────────────

function toolResultOutput(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (!Array.isArray(value)) {
    const one = record(value)
    const text = str(one?.text) ?? str(one?.content)
    return text ?? (value === undefined || value === null ? '' : JSON.stringify(value))
  }
  const parts: string[] = []
  for (const item of value) {
    if (typeof item === 'string') {
      parts.push(item)
      continue
    }
    const text = str(record(item)?.text) ?? str(record(item)?.content)
    if (text) {
      parts.push(text)
    }
  }
  return parts.join('\n')
}

function contentBlocks(content: unknown): { blocks: NativeChatBlock[]; thinking: string[]; pictures: string[] } {
  if (typeof content === 'string') {
    return { blocks: content.trim() ? [{ type: 'text', text: content }] : [], thinking: [], pictures: [] }
  }
  const blocks: NativeChatBlock[] = []
  const thinking: string[] = []
  const pictures: string[] = []
  if (!Array.isArray(content)) {
    return { blocks, thinking, pictures }
  }
  for (const item of content) {
    if (typeof item === 'string') {
      if (item.trim()) {
        blocks.push({ type: 'text', text: item })
      }
      continue
    }
    const block = record(item)
    switch (block?.type) {
      case 'text': {
        const text = str(block.text)
        if (text) {
          blocks.push({ type: 'text', text })
        }
        break
      }
      case 'thinking': {
        // The reasoning's words; a redacted or signature-only block has none to show.
        const text = str(block.thinking)?.trim()
        if (text) {
          thinking.push(text)
        }
        break
      }
      case 'tool_use': {
        const callId = str(block.id)
        blocks.push({ type: 'tool-call', name: str(block.name) ?? 'tool', input: block.input, ...(callId ? { callId } : {}) })
        break
      }
      case 'tool_result': {
        const callId = str(block.tool_use_id)
        const result: NativeChatToolResultBlock = {
          type: 'tool-result',
          output: toolResultOutput(block.content),
          ...(block.is_error === true ? { isError: true } : {}),
          ...(callId ? { callId } : {})
        }
        blocks.push(result)
        break
      }
      case 'image': {
        const uri = keptImageUri(block)
        if (uri) {
          pictures.push(uri)
        }
        break
      }
      default:
        // redacted_thinking, server tools and anything newer: not drawn, as Orca's decoder does.
        break
    }
  }
  return { blocks, thinking, pictures }
}

/**
 * The files a prompt carried, from `payload.file_attachments` (`[{file_uuid, file_name, is_image}]`,
 * recorded 2026-10-15 on events a phone or the Claude app sent: the files sit NEXT to the message,
 * whose `content` is a plain string, empty when the prompt was only files). An entry that is not
 * that shape is left out, and so is a list that is not a list: refusing beats guessing a card.
 */
function readFileAttachments(value: unknown): CcrAttachmentRef[] {
  if (!Array.isArray(value)) {
    return []
  }
  const refs: CcrAttachmentRef[] = []
  for (const item of value) {
    const entry = record(item)
    const fileUuid = str(entry?.file_uuid)
    const fileName = str(entry?.file_name)
    if (fileUuid && fileName) {
      refs.push({ fileUuid, fileName, isImage: entry?.is_image === true })
    }
  }
  return refs
}

const IMAGE_MARKER = /\[Image #\d+\]/
const REPLAY_HIDDEN_ORIGINS = new Set(['peer', 'channel', 'coordinator', 'observer'])

/**
 * The pictures one slim event kept, for the image cache the Read rows and the `[Image #N]`
 * chips are drawn from (ccr-session-cache.ts `storeCcrImages`): a Read's first picture by its
 * call id, a prompt's pictures by its uuid in order ('' where one could not be kept, so that
 * marker stays a chip).
 */
export function ccrKeptImages(event: CcrEvent): { tool: Map<string, string>; user: Map<string, string[]> } {
  const tool = new Map<string, string>()
  const user = new Map<string, string[]>()
  const payload = event.payload
  const uuid = str(payload.uuid)
  const content = record(payload.message)?.content
  if (payload.type !== 'user' || !uuid || !Array.isArray(content)) {
    return { tool, user }
  }
  const pasted: string[] = []
  for (const item of content) {
    const block = record(item)
    if (block?.type === 'image') {
      const source = record(block.source)
      if (source?.type === 'kept' || source?.type === 'kept-skip') {
        pasted.push(keptImageUri(block) ?? '')
      }
    } else if (block?.type === 'tool_result') {
      const id = str(block.tool_use_id)
      const first = ccrToolResultImageUris(block)[0]
      if (id && first) {
        tool.set(id, first)
      }
    }
  }
  if (pasted.length > 0) {
    user.set(uuid, pasted)
  }
  return { tool, user }
}

/** The Claude app's words for an `api_error` of `claude_code_version_too_old` (`ccr_model_requires_newer_cli`). */
export const CCR_MODEL_REQUIRES_NEWER_CLI = 'Update Claude Code on the computer running this session to use this model.'

/** The words Claude Code writes as the user's turn when a turn is interrupted. */
const INTERRUPT_MARKERS = new Set(['[Request interrupted by user]', '[Request interrupted by user for tool use]'])

function isInterruptMarker(blocks: readonly NativeChatBlock[]): boolean {
  return blocks.length === 1 && blocks[0]!.type === 'text' && INTERRUPT_MARKERS.has(blocks[0]!.text.trim())
}

/** Whether an event is the lead's Stop marker: no row, but the end of its turn (ccr-live-state.ts). */
export function isCcrInterruptEvent(event: CcrEvent): boolean {
  const payload = event.payload
  return payload.type === 'user' && !str(payload.parent_tool_use_id) && isInterruptMarker(contentBlocks(record(payload.message)?.content).blocks)
}

// ─── Events → rows ─────────────────────────────────────────────────────────

/** Whether an event draws a row (what is persisted for the first paint). */
export function ccrEventDrawsRow(event: CcrEvent): boolean {
  // From the decode cache the chat draws with: a held event is decoded once, not on every
  // streamed event's persist (review 2026-10-15).
  return decodeCcrEvents([event]).length > 0
}

/** The rows one event draws, oldest first; none for an event the chat does not show. */
export function decodeCcrEvent(event: CcrEvent): NativeChatMessage[] {
  const payload = event.payload
  const uuid = str(payload.uuid) ?? event.eventId
  if (!uuid) {
    return []
  }
  const timestamp = event.createdAt ?? null
  switch (payload.type) {
    case 'user':
    case 'assistant':
      return decodeMessage(payload, uuid, timestamp)
    case 'system':
      // The app draws a row for one subtype only, `compact_boundary` (qhu.java:992-996, t330.java:
      // 476-500); `init`, `status`, task and background-task changes, `thinking_tokens`,
      // `permission_denied` and every other subtype feed state or nothing (qhu.java:982-1086).
      // `model_refusal_fallback` / `model_refusal_no_fallback` are cards there (ucr/xcr); their
      // fields have not been captured, so they draw nothing here rather than a guess.
      return payload.subtype === 'compact_boundary' && !str(payload.parent_tool_use_id)
        ? [{ id: uuid, role: 'system', blocks: [{ type: 'text', text: compactionCaption(readCompactionTokens(payload.compact_metadata ?? payload.compactMetadata)), presentation: 'compaction' }], timestamp, source: 'transcript' }]
        : []
    case 'conversation_reset':
      // A /clear: the app's "Context cleared" divider (qhu.java:1132-1158, yv8.java:10435).
      return [
        {
          id: uuid,
          role: 'system',
          blocks: [{ type: 'text', text: 'Context cleared', contextClear: { operationId: uuid, afterFence: event.sequenceNum ?? 0, clearedAt: timestamp ?? 0 } }],
          timestamp,
          source: 'transcript'
        }
      ]
    default:
      // `result` anchors the turn and draws nothing (m330.java:311); `rate_limit_event` is a banner,
      // `stream_event` is the live draft. A `can_use_tool` `control_request` is the permission card,
      // read off the events by ccr-permission-request.ts (use-ccr-control-lane.ts), not a row.
      return []
  }
}

function decodeMessage(payload: Record<string, unknown>, uuid: string, timestamp: number | null): NativeChatMessage[] {
  // A subagent's own messages (`parent_tool_use_id` set) belong to its Agent call, not to the
  // conversation: Orca's transcript of the session never held them either.
  if (str(payload.parent_tool_use_id)) {
    return []
  }
  const role = payload.type === 'user' ? 'user' : 'assistant'
  // The app hides these whole (alt.h, bytecode alt.java:197-230): a record kept for the transcript
  // only, and a replayed message that came from a peer, channel, coordinator or observer.
  const origin = str(record(payload.origin)?.kind)
  if (payload.isVisibleInTranscriptOnly === true || (role === 'user' && payload.isReplay === true && origin !== null && REPLAY_HIDDEN_ORIGINS.has(origin))) {
    return []
  }
  // An API error is the agent's plain words, save the one class the app rewords (nx30.f, t5v n8u.o).
  if (role === 'assistant' && payload.api_error === 'claude_code_version_too_old') {
    return [{ id: uuid, role, blocks: [{ type: 'text', text: CCR_MODEL_REQUIRES_NEWER_CLI }], timestamp, source: 'transcript' }]
  }
  const message = record(payload.message)
  const { blocks: text, thinking, pictures } = contentBlocks(message?.content)
  if (role === 'assistant' && isLocalCommandOutput(payload, message?.model)) {
    // A slash command's own output (`/code-review …` starting its background agent): the app's
    // command-output row, with the tags it does not draw taken out (mobile-native-chat-local-command.ts).
    const output = text.flatMap((block): NativeChatBlock[] => {
      if (block.type !== 'text') {
        return [block]
      }
      const drawn = localCommandDrawnText(block.text)
      return drawn ? [{ type: 'text', text: drawn, presentation: LOCAL_COMMAND_PRESENTATION }] : []
    })
    return output.length > 0 ? [{ id: uuid, role: 'assistant', blocks: output, timestamp, source: 'transcript' }] : []
  }
  // A prompt that names its pictures (`[Image #N]`, a paste in the terminal) has them drawn where
  // the markers are, from the image cache (ccrKeptImages below, use-ccr-session-images.ts); one
  // that names none (sent from the Claude app or the phone) gets them as tiles of its own.
  const named = text.some((block) => block.type === 'text' && IMAGE_MARKER.test(block.text))
  // The prompt's files lead its blocks: the chat draws them as a row of cards above the bubble.
  const files = role === 'user' ? readFileAttachments(payload.file_attachments).map(ccrAttachmentBlock) : []
  const decoded: NativeChatBlock[] = [...files, ...(named ? text : [...text, ...pictures.map((url): NativeChatBlock => ({ type: 'image-ref', url }))])]
  // Stop's marker is no row in the app (u5a.j, t5v); the turn's end is read from it in ccr-live-state.ts.
  if (role === 'user' && isInterruptMarker(decoded)) {
    return []
  }
  // Injected user turns (meta, synthetic, a compaction's summary) show only their tool results.
  const injected = role === 'user' && (payload.isMeta === true || payload.isSynthetic === true || payload.isCompactSummary === true)
  const blocks = injected ? decoded.filter((block) => block.type === 'tool-result') : decoded
  const rows: NativeChatMessage[] = []
  if (thinking.length > 0) {
    rows.push({ id: `${uuid}:thinking`, role: 'reasoning', blocks: [{ type: 'text', text: thinking.join('\n\n') }], timestamp, source: 'transcript' })
  }
  if (blocks.length > 0) {
    const onlyResults = role === 'user' && blocks.every((block) => block.type === 'tool-result')
    rows.push({ id: uuid, role: onlyResults ? 'tool' : role, blocks, timestamp, source: 'transcript' })
  }
  return rows
}

/** Every event's rows, in the events' order. Decoding is per event and cached by identity. */
export function decodeCcrEvents(events: readonly CcrEvent[], cache: WeakMap<CcrEvent, NativeChatMessage[]> = defaultCache): NativeChatMessage[] {
  const rows: NativeChatMessage[] = []
  for (const event of events) {
    let decoded = cache.get(event)
    if (!decoded) {
      decoded = decodeCcrEvent(event)
      cache.set(event, decoded)
    }
    rows.push(...decoded)
  }
  return joinAdjacentThoughts(rows)
}

const defaultCache = new WeakMap<CcrEvent, NativeChatMessage[]>()
