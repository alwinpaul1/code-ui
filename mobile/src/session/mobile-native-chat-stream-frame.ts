import { applyAppend, replaceList } from '../../../src/shared/native-chat-merge'
import type { NativeChatMerger } from '../../../src/shared/native-chat-merge'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

export type MobileNativeChatStreamFrame = {
  type?: string
  messages?: NativeChatMessage[]
  hasMore?: boolean
  beforeOffset?: number
  /** Snapshot only: no transcript file exists behind this window yet (the agent
   *  has not flushed, or was never prompted). The empty list is real enough to
   *  render, but it is not a settled read of the session's history. */
  pending?: boolean
  error?: string
  message?: string
}

export type AppliedMobileNativeChatFrame =
  | { kind: 'ignored' }
  | { kind: 'error'; error: string }
  | {
      kind: 'messages'
      messages: NativeChatMessage[]
      hasMore?: boolean
      beforeOffset?: number
      cursorInvalidated?: boolean
      /** The frame replaced the whole retained window (replacement, first
       *  snapshot, or a replay snapshot disjoint from local history) — the
       *  caller must reset its paging window/cursor to the frame's. */
      windowReplaced?: boolean
      /** The transcript behind this window does not exist yet: show it, but keep
       *  the read open — the real snapshot follows on the same subscription. */
      pending?: boolean
    }

function replayRetainedTailStart(
  merger: NativeChatMerger,
  messages: readonly NativeChatMessage[],
  hasMore: boolean | undefined
): number | null {
  const firstIndex = messages[0] ? merger.indexById.get(messages[0].id) : undefined
  if (firstIndex === undefined) {
    return null
  }
  // `hasMore: false` is authoritative: retained rows before the replay window
  // were removed while disconnected, even when the newest IDs still match.
  if (hasMore === false && firstIndex > 0) {
    return null
  }
  let expectedIndex = firstIndex
  let sawNewMessage = false
  for (const message of messages) {
    const existingIndex = merger.indexById.get(message.id)
    if (existingIndex === undefined) {
      sawNewMessage = true
    } else if (sawNewMessage || existingIndex !== expectedIndex) {
      return null
    } else {
      expectedIndex += 1
    }
  }
  return expectedIndex === merger.list.length ? firstIndex : null
}

/** Applies runtime stream frames while preserving the initial-snapshot versus
 *  reconnect-replay distinction owned by the session hook. A replay snapshot
 *  that extends a contiguous retained tail merges in by id — paged-in history
 *  survives a socket blip instead of collapsing to the replayed window. A
 *  discontinuous replay (long outage, compaction while away) can't be stitched
 *  without a gap, so it falls back to the fresh authoritative window. */
/** How many transcript records the live window may hold.
 *
 *  Sized by what one long turn actually produces, not by what fills a screen:
 *  the turn that exposed this wrote 67 records in eight minutes, and a busy one
 *  can write several times that. Generous enough that no realistic turn evicts
 *  its own head, small enough that a day-long session does not keep every row
 *  and every tool output alive on a phone. Paging older history still grows the
 *  read window past this on demand. */
export const LIVE_WINDOW_CEILING = 400

export function applyMobileNativeChatStreamFrame(args: {
  merger: NativeChatMerger
  frame: MobileNativeChatStreamFrame
  limit: number
  /** Ceiling the live window may grow to. Defaults to `LIVE_WINDOW_CEILING`;
   *  tests pass a small one to exercise trimming without 400 rows. */
  ceiling?: number
  replaceSnapshot: boolean
}): AppliedMobileNativeChatFrame {
  const { merger, frame, limit, replaceSnapshot } = args
  const ceiling = args.ceiling ?? LIVE_WINDOW_CEILING
  if (frame.type === 'error') {
    return { kind: 'error', error: frame.message ?? frame.error ?? 'Transcript stream failed' }
  }
  if (frame.type !== 'snapshot' && frame.type !== 'replacement' && frame.type !== 'appended') {
    return { kind: 'ignored' }
  }
  if (frame.error) {
    return { kind: 'error', error: frame.error }
  }
  if (!Array.isArray(frame.messages)) {
    return { kind: 'ignored' }
  }
  const pending = frame.type === 'snapshot' && frame.pending === true
  const replayStartIndex =
    frame.type === 'snapshot' && !replaceSnapshot && merger.list.length > 0
      ? replayRetainedTailStart(merger, frame.messages, frame.hasMore)
      : null
  if (frame.type === 'replacement' || (frame.type === 'snapshot' && replayStartIndex === null)) {
    replaceList(merger, frame.messages)
    return {
      kind: 'messages',
      messages: merger.list,
      hasMore: frame.hasMore,
      windowReplaced: true,
      ...(pending ? { pending: true } : {}),
      ...(frame.beforeOffset == null ? {} : { beforeOffset: frame.beforeOffset })
    }
  }
  const previousFirstId = merger.list[0]?.id
  // The live window may only GROW. Re-trimming to the subscribe limit on every
  // append made a long turn evict its own earlier replies while the user was
  // reading it: Claude Code writes one record per content block, so a reply
  // plus three commands is seven records and a 40-record window is about four
  // replies. A turn of 67 records therefore threw away its own head, and the
  // user's bubble — anchored on a row that had just gone — was re-pinned to the
  // top of what remained, which read as "my message and the replies after it
  // are missing" (2026-09-15). The bound still exists so a long session cannot
  // grow without limit; it is simply no longer the size of the first page.
  // Live appends may only GROW the window; a snapshot replay keeps the original
  // bound, so every paging contract built on a replay's metadata is untouched.
  //
  // Re-trimming to the subscribe limit on every APPEND is what made a long turn
  // evict its own earlier replies while the user was reading it: Claude Code
  // writes one record per content block, so a reply plus three commands is
  // seven records and a 40-record window is about four replies. A turn of 67
  // records threw away its own head, and the user's bubble — anchored on a row
  // that had just gone — was re-pinned to the top of what remained, which read
  // as "my message and the replies after it are missing" (2026-09-15).
  const messages = applyAppend(
    merger,
    frame.messages,
    frame.type === 'appended' ? Math.max(limit, ceiling) : limit
  )
  const cursorInvalidated = Boolean(previousFirstId && messages[0]?.id !== previousFirstId)
  const replayStillStartsAtOldest = frame.type === 'snapshot' && replayStartIndex === 0
  return {
    kind: 'messages',
    messages,
    ...(pending ? { pending: true } : {}),
    // Why: once the bounded live window drops its oldest row, the snapshot's
    // byte cursor no longer describes the oldest retained message.
    ...(cursorInvalidated ? { cursorInvalidated: true } : {}),
    // A trimmed replay creates page-able history even if the prior window had
    // none; otherwise only a replay sharing our oldest row owns its metadata.
    ...(frame.type === 'snapshot' && cursorInvalidated
      ? { hasMore: true }
      : replayStillStartsAtOldest
        ? {
            ...(frame.hasMore == null ? {} : { hasMore: frame.hasMore }),
            ...(frame.beforeOffset == null ? {} : { beforeOffset: frame.beforeOffset })
          }
        : {})
  }
}
