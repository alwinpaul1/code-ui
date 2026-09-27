import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { isPeerBoilerplateRow, peerBoilerplateRow, teammateTaskSender } from './mobile-native-chat-peer-messages'
import { agentMessageRow } from './mobile-native-chat-agent-messages'
import type { ScreenPeerRow } from './mobile-terminal-peer-notices'

/**
 * Peer-message rows read off the screen, placed into the chat.
 *
 * A subagent's row says only who wrote (`› Message from @probe (ctrl+o to
 * expand)`); another session's row carries the message too
 * (mobile-terminal-peer-notices.ts). The phone remembers each sighting with
 * the id of the last folded row at that moment. A row already on the screen
 * when the chat first reads it (a return to the session, a reconnect) was
 * not seen arriving: it goes after the last row the chat held when it last
 * read the screen, or is not drawn when that cannot place it
 * (use-screen-peer-notices.ts, 2026-09-27). Another session's message is
 * drawn after that row as the same bubble a transcript turn gets: the
 * harness's boilerplate, the way the Claude app shows a peer message, and
 * nothing of the message or the sender (the user's call, 2026-09-21; the
 * earlier card and one-liner are gone). A subagent's row gets no bubble
 * (drawsPeerBubble); where no prompt hook carries the message, it is drawn as
 * the folded "Message from <sender>" row the desktop TUI shows (2026-09-26).
 * The body is still remembered for what follows. When the transcript
 * later carries the turn itself (a row Orca did publish, surfaced by
 * mobile-native-chat-peer-messages.ts) at or after that anchor, the notice
 * steps aside for it, one notice per landed bubble in order; every bubble
 * reads the same, so pairing by order rather than sender changes nothing on
 * screen. The many that never land stay for the session (Jev 0.64 that this
 * is honest, 2026-09-20).
 */

/** Every row this module draws has an id that starts so. */
export const SCREEN_NOTICE_ID_PREFIX = 'peer-notice:'

export type ScreenPeerNotice = {
  id: string
  sender: string
  /** The message as the screen painted it, when the row carried one. */
  body?: string
  /** The last folded transcript row when first seen; null on an empty chat.
   *  Never a row the phone drew itself: those come and go. */
  anchorId: string | null
  /** A "Message from" row the phone drew after that one, when it was the
   *  chat's last: the notice goes after it while it is still drawn. */
  afterId?: string
  /** Transcript clock at the sighting, for the synthetic row's timestamp. */
  sightedAt: number
  /** The phone's clock at the sighting: what pairs the row with another
   *  source's copy of its message (bodyOf). */
  seenAt?: number
  /** On the screen already when the chat first read it, not watched
   *  arriving: anchored at the last row the chat held when it last read the
   *  screen (the message came after that), and untimed, so it never takes
   *  another copy's words. */
  found?: true
  /** Found with nothing to place it by: kept, so it is not counted again,
   *  and never drawn. `why` says what was missing, for the log. */
  held?: true
  why?: string
  /** Found while the transcript was not yet the host's as of now: counted,
   *  not drawn, and placed once it is (placePendingNotices). */
  pending?: true
}

/** Where a row found on the chat's first read of the screen goes: after the
 *  last row the chat held when it last read the screen, or nowhere, and why;
 *  or, while the transcript is not settled, not decided yet. */
export type FoundPlacement = { id: string; at: number } | { why: string } | { pending: true }

/** The notices with each pending one placed, or held, as `placement` says.
 *  Same array when none is pending. */
export function placePendingNotices(
  notices: readonly ScreenPeerNotice[],
  placement: Exclude<FoundPlacement, { pending: true }>
): readonly ScreenPeerNotice[] {
  if (!notices.some((notice) => notice.pending === true)) {
    return notices
  }
  return notices.map((notice) => {
    if (notice.pending !== true) {
      return notice
    }
    const { pending: _pending, ...rest } = notice
    return 'why' in placement
      ? { ...rest, anchorId: null, held: true as const, why: placement.why }
      : { ...rest, anchorId: placement.id, sightedAt: placement.at }
  })
}

/**
 * One poll's rows are a multiset by sender; a sender's Nth row is that
 * sender's Nth message, and the count of a sender's messages is the most of
 * its rows the screen has shown at once. New ones are appended, anchored at
 * `tailId`, and drawn after `afterId` while it is drawn; the SAME array comes
 * back when the poll showed nothing new.
 *
 * The count alone cannot see a second message from a sender once the first
 * has scrolled off: one row on screen and one message known read as nothing
 * new. That is the trade, and it is taken on purpose. Four rules that tried to
 * tell a later row by what was painted above it (the text above it, the line
 * right above it, transcript records that arrived after the first sighting)
 * each drew one message twice: after a resize repainted a table, near the top
 * of the screen, under output printed again, and for a peer message that
 * waited alone in the queue box and was repainted in the turn when Claude
 * took it (reviews of 2026-09-26 and 2026-09-27). Position on the screen
 * cannot tell a repaint from a new message, and a missing row beats a
 * duplicate. A tab launched with the prompt hook draws each subagent message
 * from the hook's own list (mobile-native-chat-agent-message-rows.ts), so the
 * cost falls on tabs without it.
 */
export function observeScreenPeerNotices(
  previous: readonly ScreenPeerNotice[],
  rows: readonly ScreenPeerRow[],
  tailId: string | null,
  now: number,
  afterId?: string,
  /** The phone's clock now. */
  seenAt: number = Date.now(),
  /** Set when this is the chat's first read of the screen since it began
   *  watching it (a mount, a reconnect): the rows new to it were painted
   *  before it looked, and go where this says (use-screen-peer-notices.ts). */
  found?: FoundPlacement
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
      const id = `${SCREEN_NOTICE_ID_PREFIX}${sender}:${ordinal}`
      if (found !== undefined) {
        // Found: the tail now is where the chat looked, not where it came,
        // and a row the lead answered before the chat looked sat under the
        // answer (device, 2026-09-27, session 790eafa8).
        next.push(
          'pending' in found
            ? { id, sender, ...(body ? { body } : {}), anchorId: null, sightedAt: now, found: true, pending: true }
            : 'why' in found
              ? { id, sender, ...(body ? { body } : {}), anchorId: null, sightedAt: now, found: true, held: true, why: found.why }
              : { id, sender, ...(body ? { body } : {}), anchorId: found.id, sightedAt: found.at, found: true }
        )
        continue
      }
      next.push({
        id,
        sender,
        ...(body ? { body } : {}),
        anchorId: tailId,
        ...(afterId !== undefined ? { afterId } : {}),
        sightedAt: now,
        seenAt
      })
    }
  }
  return next ?? previous
}

/** The folded chat with each notice drawn after its anchor, minus the ones a
 *  landed transcript row has taken over. Same array when there are none.
 *
 *  `subagentRows`: draw a subagent's sender-only row as the folded "Message
 *  from <sender>" row (MobileNativeChatAgentMessageRow), the way the desktop
 *  TUI draws it (the user's call, 2026-09-26). Off on a tab launched with the
 *  prompt hook, which carries the same message with its words
 *  (mobile-native-chat-agent-message-rows.ts), so it is drawn once. */
export function withScreenPeerNotices(
  folded: readonly NativeChatMessage[],
  allNotices: readonly ScreenPeerNotice[],
  options: { subagentRows?: boolean; bodies?: readonly ScreenRowBody[] } = {}
): NativeChatMessage[] {
  if (allNotices.length === 0) {
    return folded as NativeChatMessage[]
  }
  const notices = allNotices.filter(
    (notice) =>
      notice.held !== true && notice.pending !== true && (drawsPeerBubble(notice) || options.subagentRows === true)
  )
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
    // After the drawn row it was seen under, while that row is still drawn
    // after the anchor; once it is gone, after the anchor itself.
    const drawnAfter = notice.afterId === undefined ? undefined : index.get(notice.afterId)
    if (anchorAt !== null && anchorAt >= 0 && drawnAfter !== undefined && drawnAfter > anchorAt) {
      anchorAt = drawnAfter
    }
    // At or after the anchor: the poll that first saw the screen row may
    // have run after the transcript already carried the message, in which
    // case the anchor IS the landed row.
    // A lead's message in a teammate session lands as the user's bubble
    // rather than the boilerplate one. It is the same message only when the
    // sender matches: every boilerplate bubble reads the same, a task does not.
    const isOwnTask = (message: NativeChatMessage) => teammateTaskSender(message) === notice.sender
    // A sender-only row steps aside only for its own lead's task: no
    // transcript row stands for a subagent's message (Orca drops them), and a
    // boilerplate bubble belongs to another session's message.
    const standsFor = drawsPeerBubble(notice)
      ? (message: NativeChatMessage) => isPeerBoilerplateRow(message) || isOwnTask(message)
      : isOwnTask
    let landed = folded.findIndex(
      (message, position) =>
        !claimed.has(position) && (anchorAt === null || position >= anchorAt) && standsFor(message)
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
    const words = drawsPeerBubble(notice) ? undefined : bodyOf(notice, allNotices, options.bodies)
    const drawn = drawsPeerBubble(notice)
      ? peerBoilerplateRow(notice.id, notice.sightedAt)
      : agentMessageRow({
          id: notice.id,
          sender: notice.sender,
          body: words ? (words.cut && words.body && !words.body.endsWith('…') ? `${words.body}…` : words.body) : '',
          cut: words?.cut,
          timestamp: notice.sightedAt
        })
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

/** Words another source carried for a sender-only row: the tab status's copy
 *  of a subagent message (parseStatusSubagentPreview), by the agent's id or
 *  the name the row shows, with when the phone first read it. */
export type ScreenRowBody = { senders: readonly string[]; body: string; cut: boolean; seenAt?: number }

/** How far apart the phone may first read a row and the status's copy of its
 *  message and still take them for one message. The hook that puts a message
 *  on the status fires as Claude takes it, which is when it paints the row;
 *  the screen is read once a second. */
export const ROW_WORDS_WINDOW_MS = 10_000

/**
 * The words of a sender-only row: the one copy from that sender the phone
 * first read within ROW_WORDS_WINDOW_MS of first seeing the row, and no other
 * row of the sender so close to that copy. The row names only its sender, and
 * each side can miss a message the other saw: one copy on each side did not
 * make them one message, and a row opened to another message's words (review
 * of 2026-09-27). With no such evidence, no words.
 */
function bodyOf(
  notice: ScreenPeerNotice,
  notices: readonly ScreenPeerNotice[],
  bodies: readonly ScreenRowBody[] | undefined
): ScreenRowBody | undefined {
  const near = (seenAt: number | undefined, body: ScreenRowBody) =>
    seenAt !== undefined && body.seenAt !== undefined && Math.abs(body.seenAt - seenAt) <= ROW_WORDS_WINDOW_MS
  const theirs = (bodies ?? []).filter((body) => body.senders.includes(notice.sender) && near(notice.seenAt, body))
  const body = theirs.length === 1 ? theirs[0]! : undefined
  const rivals = notices.filter(
    (other) => other !== notice && other.sender === notice.sender && !drawsPeerBubble(other) && body !== undefined && near(other.seenAt, body)
  )
  return rivals.length === 0 ? body : undefined
}

/**
 * Whether the Claude app draws a peer bubble for what this row announced.
 *
 * Only for another session's message, which the screen paints with the message
 * inline ("› Message from @code-ui-6f: Capture probe…"). A row that names only
 * the sender ("› Message from @a8f65c53ecfad2908 (ctrl+o to expand)") is a
 * subagent reporting back to this session: Claude Code records every one of
 * those since 2.1.272 as a queued_command with origin.kind "peer" and handback
 * true (22 of 22 on this machine), and the Claude app draws no bubble for it,
 * only this session's own "Messaged @agent" call (2026-09-24, from the phone,
 * reversing 2026-09-21's bubble before every subagent reply). Such a row is
 * drawn instead as the folded row the desktop TUI shows, when the caller asks
 * (`subagentRows`, 2026-09-26): never as a bubble.
 */
function drawsPeerBubble(notice: ScreenPeerNotice): boolean {
  return notice.body !== undefined
}

