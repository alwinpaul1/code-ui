import { formatAgentTypeLabel } from '../../../src/shared/agent-type-label'
import {
  formatNativeChatEmptyStateCopy,
  type NativeChatEmptyStateCopy
} from '../../../src/shared/native-chat-empty-state'
import { stripNoiseMessages } from '../../../src/shared/native-chat-noise'
import { foldToolMessages } from '../../../src/shared/native-chat-tool-fold'
import {
  isImageRefBlock,
  type NativeChatBlock,
  type NativeChatMessage
} from '../../../src/shared/native-chat-types'
import {
  isImageSourceUserTurn,
  normalizeImageTranscriptMessages
} from './mobile-native-chat-image-transcript-markers'
import type { MobileNativeChatStatus } from './use-mobile-native-chat-session'

/** The centered empty-state copy for a chat with no messages, mirroring the
 *  desktop `NativeChatEmptyState` (shared copy + agent label) so the two surfaces
 *  stay in lockstep. Returns null when the list should stay bare (idle, or the
 *  loading spinner owns the view). */
export function mobileNativeChatEmptyState(
  status: MobileNativeChatStatus,
  agent: string | null,
  error?: string
): NativeChatEmptyStateCopy | null {
  const agentLabel = agent ? formatAgentTypeLabel(agent) : 'the agent'
  switch (status) {
    // A live agent with no transcript yet — an unwritten transcript file, or a
    // loaded-but-empty one — is "start a chat"; invite the first message instead
    // of implying the agent is still starting up.
    case 'waiting-session':
    case 'awaiting-transcript':
    case 'ready':
      return formatNativeChatEmptyStateCopy('empty', agentLabel)
    case 'error': {
      const copy = formatNativeChatEmptyStateCopy('error', agentLabel)
      return error ? { ...copy, subtitle: error } : copy
    }
    default:
      return null
  }
}

/** An optimistic user echo: the text and/or the local preview URIs of any images
 *  ridden along on the send, shown until the transcript catches up. */
export type MobileNativeChatPendingItem = {
  id: string
  text: string
  images?: string[]
  /** Transcript tail when the send was issued. The echo renders directly after
   *  that row, so a send whose row never arrives stays where it was sent instead
   *  of trailing every turn that lands afterwards. */
  baselineTailMessageId?: string | null
  restored?: boolean
}

export function foldMobileNativeChatMessages(
  messages: NativeChatMessage[],
  splitAfterIds?: ReadonlySet<string>
): NativeChatMessage[] {
  // Normalize first (desktop assembler parity): image marker turns fold into
  // image-ref blocks instead of rendering as raw `[Image: …]` text.
  const normalized = normalizeImageTranscriptMessages(messages)
  if (!splitAfterIds?.size) {
    return stripNoiseMessages(foldToolMessages(normalized))
  }
  // A send the phone made mid-turn is anchored after the row it was sent
  // against; the tool calls that came after it must not fold backward past
  // it, or two sends read back to back with the work between them gone
  // (2026-09-13: the Claude app shows "Ran 12 commands" between them).
  const folded: NativeChatMessage[] = []
  let segment: NativeChatMessage[] = []
  for (const message of normalized) {
    segment.push(message)
    if (splitAfterIds.has(message.id)) {
      folded.push(...foldToolMessages(segment))
      segment = []
    }
  }
  folded.push(...foldToolMessages(segment))
  return stripNoiseMessages(folded)
}

/** Previews arrive keyed by RAW record id, because the hook that fetches them
 *  cannot see the send boundaries this fold was cut at. Here both sides are
 *  known, so each raw id is moved to the folded row that absorbed it: a row
 *  that survived the fold keeps its own id, and every raw record that did not
 *  was appended to the nearest surviving row before it (that is the only
 *  way `foldToolMessages` merges). Before this, a Read record that folded
 *  into its turn normally but stood alone after a mid-turn split was keyed by
 *  the wrong id and its thumbnail never showed (2026-09-13). */
export function remapPreviewsToFold(
  messages: readonly NativeChatMessage[],
  folded: readonly NativeChatMessage[],
  previews: Record<string, string[]> | undefined
): Record<string, string[]> | undefined {
  if (!previews || Object.keys(previews).length === 0) {
    return previews
  }
  const survivors = new Set(folded.map((message) => message.id))
  const out: Record<string, string[]> = {}
  const placed = new Set<string>()
  let last: string | null = null
  for (const message of messages) {
    if (survivors.has(message.id)) {
      last = message.id
    }
    const uris = previews[message.id]
    if (!uris?.length) {
      continue
    }
    const target = last ?? message.id
    out[target] = [...(out[target] ?? []), ...uris]
    placed.add(message.id)
  }
  // Keys the transcript does not carry (a phone send still in flight) stay as
  // they are.
  for (const [id, uris] of Object.entries(previews)) {
    if (!placed.has(id) && uris.length > 0) {
      out[id] = [...(out[id] ?? []), ...uris]
    }
  }
  return out
}

/** The raw rows pending echoes were sent against: fold boundaries. */
export function pendingFoldBoundaries(
  pending: readonly { baselineTailMessageId: string | null; baselineResolved?: boolean }[]
): Set<string> {
  const ids = new Set<string>()
  for (const item of pending) {
    if (item.baselineTailMessageId && item.baselineResolved !== false) {
      ids.add(item.baselineTailMessageId)
    }
  }
  return ids
}

/** Assemble the folded transcript, streaming text, and optimistic user echoes. */
export function buildMobileNativeChatTransientData({
  messages,
  folded,
  streaming,
  pending,
  imagePreviewsByMessageId
}: {
  /** Raw transcript rows, used to project folded-away send boundaries. */
  messages: NativeChatMessage[]
  folded: NativeChatMessage[]
  /** Streaming bubble text, already gated by `deriveMobileNativeChatStreaming`. */
  streaming: string | null
  pending: MobileNativeChatPendingItem[]
  imagePreviewsByMessageId?: Record<string, string[]>
}): { folded: NativeChatMessage[]; streaming: string | null; data: NativeChatMessage[] } {
  const previewsByFoldedId = remapPreviewsToFold(messages, folded, imagePreviewsByMessageId)
  const renderedFolded = folded.map((message) => {
    const previews = previewsByFoldedId?.[message.id]
    if (!previews?.length) {
      return message
    }
    if (message.role === 'assistant') {
      // Images the agent read, as host thumbnails: shown under its fold row
      // the way the Claude app shows them. Appended, since the transcript
      // carries no image block for a Read.
      return {
        ...message,
        blocks: [
          ...message.blocks,
          ...previews.map((url) => ({ type: 'image-ref' as const, url, alt: 'Image the agent read' }))
        ]
      }
    }
    if (message.role !== 'user') {
      return message
    }
    let previewIndex = 0
    const blocks = message.blocks.map((block) => {
      if (!isImageRefBlock(block)) {
        return block
      }
      const url = previews[previewIndex]
      previewIndex += 1
      return url ? { ...block, url } : block
    })
    // A preview with no marker to sit on goes ahead of the text, like the echo.
    const unplaced: NativeChatBlock[] = []
    while (previewIndex < previews.length) {
      unplaced.push({ type: 'image-ref', url: previews[previewIndex] })
      previewIndex += 1
    }
    return { ...message, blocks: [...unplaced, ...blocks] }
  })
  // Why anchored rather than appended: an echo whose transcript row never
  // arrives — Claude consumes a mid-turn send without writing a user record —
  // used to sit at the tail forever, re-reading below every turn that landed
  // afterwards. That is what makes the conversation look re-ordered. Rendering it
  // after the row it was sent against keeps it in place, so an unmatched echo is
  // at worst a duplicate in the right position instead of a scrambled one.
  const anchoredPending = new Map<string, NativeChatMessage[]>()
  const leadingPending: NativeChatMessage[] = []
  const trailingPending: NativeChatMessage[] = []
  const foldedIds = new Set(renderedFolded.map((message) => message.id))
  const missingBaselineIds = new Set<string>()
  for (const item of pending) {
    const baselineId = item.baselineTailMessageId
    if (baselineId && !foldedIds.has(baselineId)) {
      missingBaselineIds.add(baselineId)
    }
  }
  const foldedAnchorByRawId = new Map<string, string>()
  const leadingBaselineIds = new Set<string>()
  if (missingBaselineIds.size > 0) {
    let lastVisibleId: string | null = null
    const forwardImageBaselineIds: string[] = []
    for (const message of messages) {
      if (foldedIds.has(message.id)) {
        for (const baselineId of forwardImageBaselineIds) {
          foldedAnchorByRawId.set(baselineId, message.id)
        }
        forwardImageBaselineIds.length = 0
        lastVisibleId = message.id
      }
      if (!missingBaselineIds.has(message.id)) {
        continue
      }
      if (isImageSourceUserTurn(message)) {
        forwardImageBaselineIds.push(message.id)
      } else if (lastVisibleId) {
        foldedAnchorByRawId.set(message.id, lastVisibleId)
      } else {
        leadingBaselineIds.add(message.id)
      }
    }
  }
  for (const item of pending) {
    const bubble: NativeChatMessage = {
      id: item.id,
      role: 'user',
      // Images first, then the text, as the Claude app lays out a sent photo
      // with a caption (2026-09-13); the thumbnail shows immediately, before
      // the transcript echo lands.
      blocks: [
        ...(item.images ?? []).map((uri) => ({ type: 'image-ref' as const, url: uri })),
        ...(item.text ? [{ type: 'text' as const, text: item.text }] : [])
      ],
      timestamp: null,
      source: 'transcript'
    }
    // Tool/noise rows fold backward; image-source rows fold into their following prompt.
    const baselineId = item.baselineTailMessageId
    if (baselineId && leadingBaselineIds.has(baselineId)) {
      leadingPending.push(bubble)
      continue
    }
    const anchor = baselineId
      ? foldedIds.has(baselineId)
        ? baselineId
        : foldedAnchorByRawId.get(baselineId)
      : undefined
    if ((baselineId || item.restored) && !anchor && renderedFolded.length > 0) {
      // The captured history boundary has left the loaded window. Retain this
      // older echo before the window, never present it as a new follow-up.
      leadingPending.push(bubble)
      continue
    }
    if (!anchor || !foldedIds.has(anchor)) {
      trailingPending.push(bubble)
      continue
    }
    const siblings = anchoredPending.get(anchor)
    if (siblings) {
      siblings.push(bubble)
    } else {
      anchoredPending.set(anchor, [bubble])
    }
  }

  const data: NativeChatMessage[] = [...leadingPending]
  for (const message of renderedFolded) {
    data.push(message)
    const attached = anchoredPending.get(message.id)
    if (attached) {
      data.push(...attached)
    }
  }
  if (streaming) {
    data.push({
      id: 'streaming',
      role: 'assistant',
      blocks: [{ type: 'text', text: streaming }],
      timestamp: null,
      source: 'hook'
    })
  }
  data.push(...trailingPending)
  return { folded: renderedFolded, streaming, data }
}
