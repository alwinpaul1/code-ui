import { useEffect, useMemo, useRef } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { observeScreenPeerNotices, withScreenPeerNotices, type ScreenPeerNotice, type ScreenRowBody } from './screen-peer-notices'
import { agentMessageOf } from './mobile-native-chat-agent-messages'
import type { ScreenPeerRow } from './mobile-terminal-peer-notices'

const NONE: readonly ScreenPeerNotice[] = []

/** What a stream scope's chat has read off the screen: the rows it has seen,
 *  and the last row it held when it last read the screen. */
type Memory = { notices: readonly ScreenPeerNotice[]; lastRead?: { id: string; at: number } }

/**
 * Per stream scope, kept outside the component. It was a `useRef` and died
 * with the mount: the chat remounts on every return to the session, and the
 * first read after it took every "Message from" row still on the screen for
 * one that had just arrived, and drew it after the chat's last row, under
 * the lead's answer to it (device, 2026-09-27, session 790eafa8). Third time
 * this shape: desk prompt anchors (use-desktop-prompt-echoes.ts) and the
 * sticky HUD hold were both refs that died with the mount.
 */
const memoryByScope = new Map<string, Memory>()
const MEMORY_CAP = 32

function recall(scopeKey: string | null): Memory {
  if (scopeKey === null) {
    return { notices: NONE }
  }
  const memory = memoryByScope.get(scopeKey)
  if (memory === undefined) {
    return { notices: NONE }
  }
  memoryByScope.delete(scopeKey)
  memoryByScope.set(scopeKey, memory)
  return memory
}

function keep(scopeKey: string | null, memory: Memory): void {
  if (scopeKey === null) {
    return
  }
  memoryByScope.delete(scopeKey)
  memoryByScope.set(scopeKey, memory)
  for (const oldest of memoryByScope.keys()) {
    if (memoryByScope.size <= MEMORY_CAP) {
      break
    }
    memoryByScope.delete(oldest)
  }
}

/** The found rows already logged, so each says so once. */
const loggedFound = new Set<string>()

export function resetScreenPeerNoticesForTests(): void {
  memoryByScope.clear()
  loggedFound.clear()
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
 *  so the notice still draws below it while it is there.
 *
 *  `rows` is null until the screen's first read since the chat began watching
 *  it (use-mobile-terminal-hud-observation.ts: a mount, a reconnect). A row
 *  new on that first read was painted before the chat looked: it is drawn
 *  after the last row the chat held when it last read the screen, and not at
 *  all when there is no such reading (observeScreenPeerNotices). */
export function useScreenPeerNotices(
  rows: readonly ScreenPeerRow[] | null,
  folded: readonly NativeChatMessage[],
  scopeKey: string | null,
  /** Draw a subagent's sender-only row (see `withScreenPeerNotices`). */
  subagentRows = false,
  /** Words other sources carried for those rows. */
  bodies?: readonly ScreenRowBody[]
): NativeChatMessage[] {
  // Whether the screen has been read since the rows were last null. True to
  // start: rows handed on the first render come from a reader that was
  // already watching, and the HUD's own reader hands null first.
  const reading = useRef(true)
  const tail = folded.findLast((message) => agentMessageOf(message) === null)
  const drawnTail = folded[folded.length - 1]
  const memory = recall(scopeKey)
  let next = memory
  if (rows === null) {
    reading.current = false
  } else {
    const first = !reading.current
    reading.current = true
    const notices = observeScreenPeerNotices(
      memory.notices,
      rows,
      tail?.id ?? null,
      tail?.timestamp ?? 0,
      drawnTail !== undefined && drawnTail !== tail ? drawnTail.id : undefined,
      // The phone's clock, as before (the parameter's default).
      undefined,
      first ? (memory.lastRead ?? null) : undefined
    )
    const lastRead = tail ? { id: tail.id, at: tail.timestamp ?? 0 } : memory.lastRead
    next = { notices, ...(lastRead ? { lastRead } : {}) }
  }
  keep(scopeKey, next)
  const notices = next.notices
  // One line for each row placed without having been watched arriving, or
  // not drawn: a row in the wrong place otherwise leaves nothing to go by.
  const found = JSON.stringify(
    notices.flatMap((notice) =>
      notice.found === true
        ? [
            [
              `${scopeKey ?? ''}\0${notice.id}`,
              notice.held === true
                ? `[peer-row] not drawn: the row from @${notice.sender} was on the screen when the chat first read it, and the chat holds no earlier reading of this session to place it by`
                : `[peer-row] drawn: the row from @${notice.sender} was on the screen when the chat first read it, not watched arriving; placed after ${notice.anchorId}, the last row the chat held when it last read the screen`
            ]
          ]
        : []
    )
  )
  useEffect(() => {
    for (const [key, line] of JSON.parse(found) as [string, string][]) {
      if (!loggedFound.has(key)) {
        loggedFound.add(key)
        console.info(line)
      }
    }
  }, [found])
  return useMemo(() => withScreenPeerNotices(folded, notices, { subagentRows, bodies }), [bodies, folded, notices, subagentRows])
}
