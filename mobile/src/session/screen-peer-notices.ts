import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { PEER_MESSAGE_PRESENTATION, peerMessageLabelAndBody } from './mobile-native-chat-peer-messages'

/**
 * Peer-message rows read off the screen, placed into the chat.
 *
 * A row says only who wrote (`› Message from @probe (ctrl+o to expand)`,
 * mobile-terminal-peer-notices.ts). The phone remembers each sighting with
 * the id of the last folded row at that moment and draws a one-line notice
 * after it: "a message from that agent arrived about here", which is all it
 * knows. When the transcript later carries the message itself (a row Orca
 * did publish, surfaced by mobile-native-chat-peer-messages.ts) after that
 * anchor, the notice steps aside for it, one notice per row; the many that
 * never land stay for the session (Jev 0.64 that this is honest, 2026-09-20).
 */

export const PEER_NOTICE_PRESENTATION = 'peer-notice'

export type ScreenPeerNotice = {
  id: string
  sender: string
  /** The last folded row when first seen; null on an empty chat. */
  anchorId: string | null
  /** Transcript clock at the sighting, for the synthetic row's timestamp. */
  sightedAt: number
}

/** One poll's rows are a multiset by sender; a sender's Nth row is that
 *  sender's Nth message. New ones are appended, anchored at `tailId`; the
 *  SAME array comes back when the poll showed nothing new. */
export function observeScreenPeerNotices(
  previous: readonly ScreenPeerNotice[],
  senders: readonly string[],
  tailId: string | null,
  now: number
): readonly ScreenPeerNotice[] {
  const seen = new Map<string, number>()
  for (const sender of senders) {
    seen.set(sender, (seen.get(sender) ?? 0) + 1)
  }
  let next: ScreenPeerNotice[] | null = null
  for (const [sender, count] of seen) {
    const known = previous.filter((notice) => notice.sender === sender).length
    for (let ordinal = known + 1; ordinal <= count; ordinal += 1) {
      next ??= [...previous]
      next.push({ id: `peer-notice:${sender}:${ordinal}`, sender, anchorId: tailId, sightedAt: now })
    }
  }
  return next ?? previous
}

/** The folded chat with each notice drawn after its anchor, minus the ones a
 *  landed transcript row has taken over. Same array when there are none. */
export function withScreenPeerNotices(
  folded: readonly NativeChatMessage[],
  notices: readonly ScreenPeerNotice[]
): NativeChatMessage[] {
  if (notices.length === 0) {
    return folded as NativeChatMessage[]
  }
  const index = new Map<string, number>()
  folded.forEach((message, position) => index.set(message.id, position))
  // A landed row retires at most one notice: the earliest sighting of that
  // sender anchored before the row.
  const claimed = new Set<number>()
  const after = new Map<number, NativeChatMessage[]>()
  const atTop: NativeChatMessage[] = []
  const atEnd: NativeChatMessage[] = []
  for (const notice of notices) {
    let anchorAt = notice.anchorId === null ? null : (index.get(notice.anchorId) ?? -1)
    // At or after the anchor: the poll that first saw the screen row may
    // have run after the transcript already carried the message, in which
    // case the anchor IS the landed row.
    const landed = folded.findIndex(
      (message, position) =>
        !claimed.has(position) &&
        (anchorAt === null || position >= anchorAt) &&
        landedPeerSender(message) === notice.sender
    )
    if (landed !== -1) {
      claimed.add(landed)
      continue
    }
    // A later message from the same sender is drawn after the earlier ones
    // the transcript already carries, not between the anchor and them.
    for (const position of claimed) {
      if (anchorAt !== null && position >= anchorAt && landedPeerSender(folded[position]!) === notice.sender) {
        anchorAt = position
      }
    }
    const drawn = noticeRow(notice)
    if (anchorAt === null) {
      atEnd.push(drawn)
    } else if (anchorAt < 0) {
      // Its anchor has paged out of the loaded window: it happened before
      // everything loaded, so the top is the honest place.
      atTop.push(drawn)
    } else {
      const list = after.get(anchorAt) ?? []
      list.push(drawn)
      after.set(anchorAt, list)
    }
  }
  if (claimed.size === notices.length) {
    return folded as NativeChatMessage[]
  }
  const out: NativeChatMessage[] = [...atTop]
  folded.forEach((message, position) => {
    out.push(message)
    const drawn = after.get(position)
    if (drawn) {
      out.push(...drawn)
    }
  })
  out.push(...atEnd)
  return out
}

function landedPeerSender(message: NativeChatMessage): string | null {
  if (message.role !== 'system') {
    return null
  }
  const block = message.blocks[0]
  if (!block || block.type !== 'text' || block.presentation !== PEER_MESSAGE_PRESENTATION) {
    return null
  }
  const { label } = peerMessageLabelAndBody(block.text)
  return label.startsWith('From ') ? label.slice(5) : null
}

function noticeRow(notice: ScreenPeerNotice): NativeChatMessage {
  return {
    id: notice.id,
    role: 'system',
    timestamp: notice.sightedAt,
    source: 'transcript',
    blocks: [{ type: 'text', text: `Message from @${notice.sender}`, presentation: PEER_NOTICE_PRESENTATION }]
  }
}
