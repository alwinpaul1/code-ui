import { useEffect, useMemo, useRef } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  observeScreenPeerNotices,
  withScreenPeerNotices,
  type FoundPlacement,
  type ScreenPeerNotice,
  type ScreenRowBody
} from './screen-peer-notices'
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
/** Scopes whose screen the chat has read. A scope it never read keeps no
 *  entry: the overlay stays mounted under every tab and worktree the person
 *  passes through, and when those took entries, a dozen visits evicted the
 *  memory of a row the chat had watched arrive (review of ce17bce5). */
const MEMORY_CAP = 64

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
  if (scopeKey === null || (memory.notices.length === 0 && memory.lastRead === undefined)) {
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

/** The lines already logged, so each says so once. */
const loggedFound = new Set<string>()

/**
 * Where a row the chat's first read of the screen found goes: after the last
 * row the chat held when it last read the screen. The message came after that
 * row, and nothing says how long after, so that row places it only while no
 * prompt has started a turn since: with one, it may have come in any of those
 * turns, and anchored at the last reading it drew turns early (review of
 * ce17bce5). Nor when that row is not loaded, which drew it above the whole
 * page. Refused then: not drawn, and the log says why.
 */
function foundPlacement(lastRead: Memory['lastRead'], folded: readonly NativeChatMessage[]): FoundPlacement {
  if (lastRead === undefined) {
    return { why: 'the chat holds no earlier reading of this session to place it by' }
  }
  const position = folded.findIndex((message) => message.id === lastRead.id)
  if (position === -1) {
    return { why: `the row the chat held when it last read the screen (${lastRead.id}) is not loaded` }
  }
  if (folded.slice(position + 1).some((message) => message.role === 'user')) {
    return {
      why: `a prompt started a turn since the chat last read the screen (after ${lastRead.id}), so it may have come in any of them`
    }
  }
  return lastRead
}

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
 *  after the last row the chat held when it last read the screen, or not at
 *  all when that row cannot place it (foundPlacement). */
export function useScreenPeerNotices(
  rows: readonly ScreenPeerRow[] | null,
  folded: readonly NativeChatMessage[],
  scopeKey: string | null,
  /** Draw a subagent's sender-only row (see `withScreenPeerNotices`). */
  subagentRows = false,
  /** Words other sources carried for those rows. */
  bodies?: readonly ScreenRowBody[],
  /** Whether `folded` is the host's transcript, read and settled. Until it
   *  is, the chat shows the copy the last visit cached, or nothing, and a
   *  first read placed against that was placed for good: turns early, or
   *  refused for a row that had not loaded yet (re-review of 1045e43b). The
   *  first read waits for it. */
  settled = true
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
  } else if (!reading.current && !settled) {
    // The first read waits for the transcript; the rows stay on the screen.
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
      first ? foundPlacement(memory.lastRead, folded) : undefined
    )
    const lastRead = settled && tail ? { id: tail.id, at: tail.timestamp ?? 0 } : memory.lastRead
    next = { notices, ...(lastRead ? { lastRead } : {}) }
  }
  keep(scopeKey, next)
  const notices = next.notices
  // One line for each row placed without having been watched arriving, or
  // not drawn: a row in the wrong place otherwise leaves nothing to go by.
  // Keyed by the row and whether it is drawn: one drawn, then found again
  // with nothing to place it by, must still say it is no longer drawn.
  const found = JSON.stringify(
    notices.flatMap((notice) =>
      notice.found === true
        ? [
            [
              `${notice.id}\0${notice.held === true ? 'held' : 'drawn'}`,
              notice.held === true
                ? `[peer-row] not drawn: the row from @${notice.sender} was on the screen when the chat first read it, and ${notice.why ?? 'nothing places it'}`
                : `[peer-row] drawn: the row from @${notice.sender} was on the screen when the chat first read it, not watched arriving; placed after ${notice.anchorId}, the last row the chat held when it last read the screen`
            ]
          ]
        : []
    )
  )
  useEffect(() => {
    for (const [row, line] of JSON.parse(found) as [string, string][]) {
      const key = `${scopeKey ?? ''}\0${row}`
      if (!loggedFound.has(key)) {
        loggedFound.add(key)
        console.info(line)
      }
    }
  }, [found, scopeKey])
  return useMemo(() => withScreenPeerNotices(folded, notices, { subagentRows, bodies }), [bodies, folded, notices, subagentRows])
}
