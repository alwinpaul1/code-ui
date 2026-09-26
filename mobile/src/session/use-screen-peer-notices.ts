import { useMemo, useRef } from 'react'
import { isTextBlock, isToolCallBlock, isToolResultBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import { observeScreenPeerNotices, withScreenPeerNotices, type ScreenPeerNotice, type ScreenRowBody } from './screen-peer-notices'
import { agentMessageOf } from './mobile-native-chat-agent-messages'
import type { ScreenPeerRow } from './mobile-terminal-peer-notices'

const NONE: readonly ScreenPeerNotice[] = []

/** A line above a row this long, read on its own, is taken as evidence: a
 *  shorter one ("session:ok", "Done.") ends many replies. */
const LAST_LINE_EVIDENCE = 16

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
 * Whether what was painted above a screen row belongs to a row the chat
 * holds after `anchorId`: the 48 characters above it, or the line right
 * above it when that is long enough to tell. Tool calls and their output
 * count: the text above a message Claude takes mid-turn is usually a tool's
 * output, and without them a later row of the same sender was never drawn
 * (review of 2026-09-27). Read in the transcript as read (`raw`), where tool
 * rows are their own.
 */
export function paintedAfterAnchor(raw: readonly NativeChatMessage[], anchorId: string | null, row: ScreenPeerRow): boolean {
  const anchorAt = anchorId === null ? -1 : raw.findIndex((message) => message.id === anchorId)
  if (anchorId !== null && anchorAt === -1) {
    return false
  }
  const lastLine = row.lastLine !== undefined && row.lastLine.length >= LAST_LINE_EVIDENCE ? row.lastLine : undefined
  if (row.above === undefined && lastLine === undefined) {
    return false
  }
  return raw
    .slice(anchorAt + 1)
    .some((message) =>
      paintedWords(message).some((words) => (row.above !== undefined && words.includes(row.above)) || (lastLine !== undefined && words.includes(lastLine)))
    )
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
   *  is looked up in (paintedAfterAnchor). */
  raw: readonly NativeChatMessage[] = folded
): NativeChatMessage[] {
  const memory = useRef<{ scopeKey: string | null; notices: readonly ScreenPeerNotice[] }>({ scopeKey, notices: NONE })
  if (memory.current.scopeKey !== scopeKey) {
    memory.current = { scopeKey, notices: NONE }
  }
  const tail = folded.findLast((message) => agentMessageOf(message) === null)
  const drawnTail = folded[folded.length - 1]
  memory.current = {
    scopeKey,
    notices: observeScreenPeerNotices(
      memory.current.notices,
      rows,
      tail?.id ?? null,
      tail?.timestamp ?? 0,
      drawnTail !== undefined && drawnTail !== tail ? drawnTail.id : undefined,
      (notice, row) => paintedAfterAnchor(raw, notice.anchorId, row)
    )
  }
  const notices = memory.current.notices
  return useMemo(() => withScreenPeerNotices(folded, notices, { subagentRows, bodies }), [bodies, folded, notices, subagentRows])
}
