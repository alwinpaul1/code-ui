import { useMemo, useRef } from 'react'
import { isTextBlock, isToolCallBlock, isToolResultBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  LAST_LINE_EVIDENCE,
  observeScreenPeerNotices,
  withScreenPeerNotices,
  type ScreenPeerNotice,
  type ScreenRowBody
} from './screen-peer-notices'
import { agentMessageOf } from './mobile-native-chat-agent-messages'
import type { ScreenPeerRow } from './mobile-terminal-peer-notices'

const NONE: readonly ScreenPeerNotice[] = []

type Memory = {
  scopeKey: string | null
  notices: readonly ScreenPeerNotice[]
  arrivals: Arrivals
  /** The arrival count when each notice was first seen. */
  sighted: Map<string, number>
}

/** The words a transcript row painted: its text, a tool call's input and a
 *  tool's output, with the spaces taken out as ScreenPeerRow takes them. */
function paintedWords(message: NativeChatMessage): string[] {
  return message.blocks.flatMap((block) => {
    if (isTextBlock(block)) {
      return [block.text]
    }
    if (isToolResultBlock(block)) {
      return typeof block.output === 'string' ? [block.output] : []
    }
    if (isToolCallBlock(block)) {
      const input = block.input && typeof block.input === 'object' ? Object.values(block.input as Record<string, unknown>) : []
      return input.filter((value): value is string => typeof value === 'string')
    }
    return []
  }).map((text) => text.replaceAll(/\s+/g, ''))
}

/**
 * Whether what was painted above a screen row is in one of `records`: the 48
 * characters above it, or the line right above it when that is long enough
 * to tell. Tool calls and their output count: the text above a message Claude
 * takes mid-turn is usually a tool's output (review of 2026-09-27). The
 * caller passes only records that reached the phone after the known message
 * was first seen (arrivedAfterSighting); which records those are is the
 * whole of the evidence.
 */
export function paintedIn(records: readonly NativeChatMessage[], row: ScreenPeerRow): boolean {
  const lastLine = row.lastLine !== undefined && row.lastLine.length >= LAST_LINE_EVIDENCE ? row.lastLine : undefined
  if (row.above === undefined && lastLine === undefined) {
    return false
  }
  return records.some((message) =>
    paintedWords(message).some((words) => (row.above !== undefined && words.includes(row.above)) || (lastLine !== undefined && words.includes(lastLine)))
  )
}

/**
 * When each record reached the phone, as an order: records a read appends
 * after the ones held count up from the last; those a page of older history
 * puts in front of them are older than everything, and so are the ones the
 * first read held. Not the transcript's position after the notice's anchor:
 * the anchor is the folded tail, whose id is the first record of a run the
 * fold merged later tool records into, so tool output painted ABOVE the row
 * before it was seen counted as painted after it, and one row drew as a new
 * one on every read (re-review of 2026-09-27).
 */
type Arrivals = { order: Map<string, number>; count: number }

function withArrivals(arrivals: Arrivals, raw: readonly NativeChatMessage[]): Arrivals {
  const known = raw.reduce((last, message, index) => (arrivals.order.has(message.id) ? index : last), -1)
  let order: Map<string, number> | null = null
  let count = arrivals.count
  raw.forEach((message, index) => {
    if (!arrivals.order.has(message.id)) {
      order ??= new Map(arrivals.order)
      order.set(message.id, arrivals.order.size > 0 && index > known ? ++count : -1)
    }
  })
  return order ? { order, count } : arrivals
}

/** The peer-message rows this chat's screen has shown, remembered for as long
 *  as the tab shows the same stream (the scope key carries the session id, so
 *  a `/clear` starts over), each anchored at the last folded row of the poll
 *  that first saw it, and drawn into the folded chat. The clock is the
 *  transcript's, not the phone's: the synthetic row only needs to sort.
 *
 *  The anchor is the last TRANSCRIPT row, never a "Message from" row the phone
 *  drew (mobile-native-chat-agent-message-rows.ts): a notice anchored on one
 *  of those went to the top of the chat once the row was no longer drawn
 *  (review of 2026-09-26). Such a row, when it was last, is kept as `afterId`
 *  so the notice still draws below it while it is there. */
export function useScreenPeerNotices(
  rows: readonly ScreenPeerRow[],
  folded: readonly NativeChatMessage[],
  scopeKey: string | null,
  /** Draw a subagent's sender-only row (see `withScreenPeerNotices`). */
  subagentRows = false,
  /** Words other sources carried for those rows. */
  bodies?: readonly ScreenRowBody[],
  /** The transcript as read, tool rows included: what the text above a row
   *  is looked up in (paintedIn), and whose arrival order says which records
   *  came after a row was first seen. */
  raw: readonly NativeChatMessage[] = folded
): NativeChatMessage[] {
  const empty = (): Memory => ({ scopeKey, notices: NONE, arrivals: { order: new Map(), count: 0 }, sighted: new Map() })
  const memory = useRef<Memory>(empty())
  if (memory.current.scopeKey !== scopeKey) {
    memory.current = empty()
  }
  const tail = folded.findLast((message) => agentMessageOf(message) === null)
  const drawnTail = folded[folded.length - 1]
  const arrivals = withArrivals(memory.current.arrivals, raw)
  const sighted = memory.current.sighted
  /** The records that reached the phone after this notice was first seen. */
  const arrivedAfterSighting = (notice: ScreenPeerNotice) => {
    const mark = sighted.get(notice.id)
    return mark === undefined ? [] : raw.filter((message) => (arrivals.order.get(message.id) ?? -1) > mark)
  }
  const notices = observeScreenPeerNotices(
    memory.current.notices,
    rows,
    tail?.id ?? null,
    tail?.timestamp ?? 0,
    drawnTail !== undefined && drawnTail !== tail ? drawnTail.id : undefined,
    (notice, row) => paintedIn(arrivedAfterSighting(notice), row)
  )
  for (const notice of notices) {
    if (!sighted.has(notice.id)) {
      sighted.set(notice.id, arrivals.count)
    }
  }
  memory.current = { scopeKey, notices, arrivals, sighted }
  return useMemo(() => withScreenPeerNotices(folded, notices, { subagentRows, bodies }), [bodies, folded, notices, subagentRows])
}
