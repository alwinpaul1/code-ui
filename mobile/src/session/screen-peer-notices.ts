import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { isPeerBoilerplateRow, peerBoilerplateRow, teammateTaskSender } from './mobile-native-chat-peer-messages'
import type { ScreenPeerRow } from './mobile-terminal-peer-notices'

/**
 * Peer-message rows read off the screen, placed into the chat.
 *
 * A subagent's row says only who wrote (`› Message from @probe (ctrl+o to
 * expand)`); another session's row carries the message too
 * (mobile-terminal-peer-notices.ts). The phone remembers each sighting with
 * the id of the last folded row at that moment and draws it after that row
 * as the same bubble a transcript turn gets: the harness's boilerplate, the
 * way the Claude app shows a peer message, and nothing of the message or the
 * sender (the user's call, 2026-09-21; the earlier card and one-liner are
 * gone). The body is still remembered for what follows. When the transcript
 * later carries the turn itself (a row Orca did publish, surfaced by
 * mobile-native-chat-peer-messages.ts) at or after that anchor, the notice
 * steps aside for it, one notice per landed bubble in order; every bubble
 * reads the same, so pairing by order rather than sender changes nothing on
 * screen. The many that never land stay for the session (Jev 0.64 that this
 * is honest, 2026-09-20).
 */

export type ScreenPeerNotice = {
  id: string
  sender: string
  /** The message as the screen painted it, when the row carried one. */
  body?: string
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
  rows: readonly ScreenPeerRow[],
  tailId: string | null,
  now: number
): readonly ScreenPeerNotice[] {
  const seen = new Map<string, ScreenPeerRow[]>()
  for (const row of rows) {
    const list = seen.get(row.sender) ?? []
    list.push(row)
    seen.set(row.sender, list)
  }
  let next: ScreenPeerNotice[] | null = null
  for (const [sender, list] of seen) {
    const known = previous.filter((notice) => notice.sender === sender).length
    for (let ordinal = known + 1; ordinal <= list.length; ordinal += 1) {
      next ??= [...previous]
      const body = list[ordinal - 1]?.body
      next.push({
        id: `peer-notice:${sender}:${ordinal}`,
        sender,
        ...(body ? { body } : {}),
        anchorId: tailId,
        sightedAt: now
      })
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
  // A landed bubble retires at most one notice: the earliest sighting
  // anchored at or before the row.
  const claimed = new Set<number>()
  const after = new Map<number, NativeChatMessage[]>()
  const atTop: NativeChatMessage[] = []
  const atEnd: NativeChatMessage[] = []
  for (const notice of notices) {
    let anchorAt = notice.anchorId === null ? null : (index.get(notice.anchorId) ?? -1)
    // At or after the anchor: the poll that first saw the screen row may
    // have run after the transcript already carried the message, in which
    // case the anchor IS the landed row.
    // A lead's message in a teammate session lands as the user's bubble
    // rather than the boilerplate one. It is the same message only when the
    // sender matches: every boilerplate bubble reads the same, a task does not.
    const isOwnTask = (message: NativeChatMessage) => teammateTaskSender(message) === notice.sender
    let landed = folded.findIndex(
      (message, position) =>
        !claimed.has(position) &&
        (anchorAt === null || position >= anchorAt) &&
        (isPeerBoilerplateRow(message) || isOwnTask(message))
    )
    if (landed === -1 && anchorAt !== null && anchorAt > 0) {
      // The screen may be read first after the transcript already moved past
      // the task: opening a teammate tab soon after it spawned lands the
      // snapshot before the first screen read, and the sighting is anchored
      // after the row it saw. The latest unclaimed task from that sender is it.
      for (let position = anchorAt - 1; position >= 0; position -= 1) {
        if (!claimed.has(position) && isOwnTask(folded[position]!)) {
          landed = position
          break
        }
      }
    }
    if (landed !== -1) {
      claimed.add(landed)
      continue
    }
    // A later message is drawn after the earlier ones the transcript already
    // carries, not between the anchor and them.
    for (const position of claimed) {
      if (anchorAt !== null && position >= anchorAt) {
        anchorAt = position
      }
    }
    const drawn = peerBoilerplateRow(notice.id, notice.sightedAt)
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
