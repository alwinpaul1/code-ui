import { useMemo, useRef } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { observeScreenPeerNotices, withScreenPeerNotices, type ScreenPeerNotice } from './screen-peer-notices'
import type { ScreenPeerRow } from './mobile-terminal-peer-notices'

const NONE: readonly ScreenPeerNotice[] = []

/** The peer-message rows this chat's screen has shown, remembered for as long
 *  as the tab shows the same stream (the scope key carries the session id, so
 *  a `/clear` starts over), each anchored at the last folded row of the poll
 *  that first saw it, and drawn into the folded chat. The clock is the
 *  transcript's, not the phone's: the synthetic row only needs to sort. */
export function useScreenPeerNotices(
  rows: readonly ScreenPeerRow[],
  folded: readonly NativeChatMessage[],
  scopeKey: string | null
): NativeChatMessage[] {
  const memory = useRef<{ scopeKey: string | null; notices: readonly ScreenPeerNotice[] }>({ scopeKey, notices: NONE })
  if (memory.current.scopeKey !== scopeKey) {
    memory.current = { scopeKey, notices: NONE }
  }
  const tail = folded[folded.length - 1]
  memory.current = {
    scopeKey,
    notices: observeScreenPeerNotices(memory.current.notices, rows, tail?.id ?? null, tail?.timestamp ?? 0)
  }
  const notices = memory.current.notices
  return useMemo(() => withScreenPeerNotices(folded, notices), [folded, notices])
}
