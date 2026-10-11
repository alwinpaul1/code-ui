import { isToolCallBlock, isToolResultBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import { pendingPlacementAnchorId } from './mobile-native-chat-render-data'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

/**
 * Where a message sent mid-turn is drawn: where Claude took it, not where it
 * was sent.
 *
 * Claude Code takes a queued message between tool calls. The record it writes,
 * an `attachment`/`queued_command`, is stamped with the send but written after
 * the results of the calls that were running, so its place in the transcript
 * is the take. On 2026-10-11 (Claude Code 2.1.296, session 0954729d) the Claude
 * app drew "3. Move Stop…", typed at the desk, after "Ran Pull the phone's log
 * lines…", the call stamped ten seconds after the send; the phone drew it above
 * that call, next to the user's previous message, because its desk copy was
 * placed by the send and drawn there. Asked for the transcript's order, the
 * phone now draws every mid-turn message there: a desk copy, a queue-box
 * reading, and its own sends.
 *
 * This reverses 2026-09-23 (0db1384a4, the user's "where I sent it"), which
 * came from a screenshot of a message the Claude app had sent itself: the
 * Claude app draws its OWN send where it sent it and one sent elsewhere where
 * the agent took it (docs/claude-app-parity.md, item 14). Kept for the phone's
 * own sends alone, a desk message typed before a phone send drew below it
 * whenever both waited through the same call.
 *
 * Orca drops the record, so the phone never sees the take. What it sees is the
 * rows: the message goes after the first run of tool results written after
 * `anchorId`, the row it was placed after by its send. Until one is written,
 * while the agent works, it has not been taken (or will be, at the turn's end,
 * as a user row of its own), and it sits at the live end: after the last row.
 * Of 669 human `queued_command` records in this machine's 40 largest Claude
 * transcripts, 661 follow a tool_result and 8 an `isMeta` row written with
 * one (an image a Read returned); none follows anything else.
 *
 * With the agent idle and no result after the anchor, the anchor stays. Such
 * a message was not taken mid-turn as far as the rows show: either its own
 * user row is on its way, or the rows lack the calls (a page modeled without
 * them, an agent whose results are not result rows). The live end there would
 * be under a reply written long after, the prompt leak of 2026-09-29.
 *
 * Every row after the anchor counts as written after the send: placing the
 * anchor already moved it below the rows written before (the send's clock,
 * use-desktop-prompt-echoes.ts and mid-turn-written-before.ts). Filtering the
 * results by a time here as well was wrong: a copy found late is timed by the
 * status that carried it, minutes after the send, and every result was
 * skipped.
 *
 * A user row after the anchor, before any result, ends the search and keeps
 * the anchor: a new turn began there, which is either this message's own row
 * (it was sent while the agent was idle, and its echo retires against it) or
 * a turn this message was never part of. A null anchor, or one the phone does
 * not hold, is left as it is: nothing places it any better.
 */
export function drawnWhereTaken(
  rawMessages: readonly NativeChatMessage[],
  anchorId: string | null,
  agentWorking: boolean
): string | null {
  if (anchorId === null) {
    return null
  }
  const from = rawMessages.findIndex((message) => message.id === anchorId)
  if (from === -1) {
    return anchorId
  }
  // The end of the last result run of a step still being written: a call
  // written within STEP_CALL_GAP_MS of it is the same step's.
  let stepResult: string | null = null
  for (let index = from + 1; index < rawMessages.length; index += 1) {
    const row = rawMessages[index]!
    if (isResultRow(row)) {
      // The calls of one step come back together, and Claude takes the
      // message after the last of their results.
      let last = index
      while (last + 1 < rawMessages.length && isResultRow(rawMessages[last + 1]!)) {
        last += 1
      }
      const next = rawMessages[last + 1]
      if (next === undefined || !continuesStep(rawMessages[last]!, next)) {
        return rawMessages[last]!.id
      }
      stepResult = rawMessages[last]!.id
      index = last
      continue
    }
    if (row.role === 'user') {
      return stepResult ?? anchorId
    }
  }
  return agentWorking ? (rawMessages.at(-1)?.id ?? anchorId) : (stepResult ?? anchorId)
}

/**
 * How soon after a result a call of the SAME step is written. Claude Code
 * runs a step's calls as they stream, so one API message can write a call,
 * its result, then its next call (Ran 2 commands as one fold). Of the 910
 * such calls in 25 local transcripts, 186 came within a second of the result
 * before them; of the 6,973 calls that opened a new step after a result,
 * none did (a new step waits for the model). Rows carry no API message id,
 * so the gap is the only tell; a slower same-step call is still drawn as a
 * take (review of 2026-10-11).
 */
const STEP_CALL_GAP_MS = 1000

function continuesStep(result: NativeChatMessage, next: NativeChatMessage): boolean {
  return (
    isCallRow(next) &&
    result.timestamp !== null &&
    next.timestamp !== null &&
    next.timestamp - result.timestamp < STEP_CALL_GAP_MS
  )
}

function isResultRow(row: NativeChatMessage): boolean {
  return row.blocks.length > 0 && row.blocks.every(isToolResultBlock)
}

function isCallRow(row: NativeChatMessage): boolean {
  return row.blocks.length > 0 && row.blocks.every(isToolCallBlock)
}

/** Each pending echo drawn where Claude took it (drawnWhereTaken), from the
 *  row it is drawn after now. Placement only: `drawAfterId`, which nothing
 *  that reconciles or retires reads. */
export function placeWhereTaken<T extends MobileNativeChatPendingMessage>(
  pending: readonly T[],
  rawMessages: readonly NativeChatMessage[],
  agentWorking: boolean
): T[] {
  let changed = false
  const placed = pending.map((item) => {
    if (item.baselineResolved === false) {
      return item
    }
    const anchor = pendingPlacementAnchorId(item)
    const taken = drawnWhereTaken(rawMessages, anchor, agentWorking)
    if (taken === anchor) {
      return item
    }
    changed = true
    return { ...item, drawAfterId: taken }
  })
  return changed ? placed : (pending as T[])
}
