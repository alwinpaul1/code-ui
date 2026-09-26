import { useMemo, useRef } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { observeScreenPeerNotices, withScreenPeerNotices, type ScreenPeerNotice } from './screen-peer-notices'
import { agentMessageOf } from './mobile-native-chat-agent-messages'
import type { ScreenPeerRow } from './mobile-terminal-peer-notices'

const NONE: readonly ScreenPeerNotice[] = []

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
  subagentRows = false
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
      drawnTail !== undefined && drawnTail !== tail ? drawnTail.id : undefined
    )
  }
  const notices = memory.current.notices
  return useMemo(() => withScreenPeerNotices(folded, notices, { subagentRows }), [folded, notices, subagentRows])
}
