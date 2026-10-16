import {
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatBlock,
  type NativeChatToolCallBlock
} from '../../../src/shared/native-chat-types'
import { artifactCallViewBeside } from './mobile-native-chat-artifact-segment'

export type NativeChatTurnSegment = {
  kind: 'prose' | 'tools'
  blocks: NativeChatBlock[]
}

/**
 * One turn, cut into runs of words and runs of work, IN THE ORDER THEY HAPPENED.
 *
 * The phone used to render a turn as every word first and then every tool call
 * bundled beneath, via `splitNativeChatBlocks` — two buckets, which throws the
 * ordering away. A reply written before a command then appeared below it, and a
 * reply written after appeared above: the words lost their place relative to the
 * work. Reported 2026-09-15 against the terminal, which shows the true order.
 *
 * The block array already IS that order. `foldToolMessages` appends each
 * tool-only message onto the assistant message it followed, so a turn's blocks
 * run text, call, result, text, call… exactly as the transcript recorded them.
 * All this does is group adjacent blocks of a kind so each run can be drawn as
 * one thing — prose as prose, work as its own collapsible run.
 *
 * A plan proposal (ExitPlanMode) and a question (AskUserQuestion) are each a
 * run of their own, with their answer, as the Claude app keeps them out of
 * tool groups: "Proposed plan" and "Asked <header>" rows (2026-10-15). So is
 * an Artifact call that puts a page up or opens one: the app draws it as a
 * card of its own (a18.java:56-190, kv30.a), never inside a group. Its other
 * actions (quickstart, list, read) are ordinary calls and stay in the run.
 *
 * Nothing is dropped and nothing is reordered; concatenating the segments gives
 * the input back unchanged, which its test pins.
 */
export function splitTurnIntoSegments(
  blocks: readonly NativeChatBlock[]
): NativeChatTurnSegment[] {
  const segments: NativeChatTurnSegment[] = []
  // The plan and question rows: nothing else joins them.
  const alone = new Set<NativeChatTurnSegment>()
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!
    const kind: NativeChatTurnSegment['kind'] =
      isToolCallBlock(block) || isToolResultBlock(block) ? 'tools' : 'prose'
    const open = segments.at(-1)
    if (isToolCallBlock(block) && standsAlone(block, blocks[index + 1]) && isolated(open, alone, block, blocks[index + 1])) {
      const next = blocks[index + 1]
      const answer = next && isToolResultBlock(next) ? next : null
      const segment: NativeChatTurnSegment = { kind, blocks: answer ? [block, answer] : [block] }
      alone.add(segment)
      segments.push(segment)
      index += answer ? 1 : 0
      continue
    }
    if (open?.kind === kind && !alone.has(open)) {
      open.blocks.push(block)
    } else {
      segments.push({ kind, blocks: [block] })
    }
  }
  return segments
}

/** Whether a plan or question call can be a row of its own without parting any
 *  call from its result: every call before it in the run is answered, and the
 *  block after it is its own answer, words, or nothing. Made beside other calls
 *  (their results interleaved with its own), it stays in the run, where each
 *  result still pairs with its call (review, 2026-10-15). */
function isolated(
  open: NativeChatTurnSegment | undefined,
  alone: ReadonlySet<NativeChatTurnSegment>,
  call: NativeChatToolCallBlock,
  next: NativeChatBlock | undefined
): boolean {
  if (open?.kind === 'tools' && !alone.has(open) && unanswered(open.blocks) > 0) {
    return false
  }
  if (!next || !(isToolCallBlock(next) || isToolResultBlock(next))) {
    return true
  }
  return isToolResultBlock(next) && (call.callId === undefined || next.callId === undefined || call.callId === next.callId)
}

function unanswered(blocks: readonly NativeChatBlock[]): number {
  let open = 0
  for (const block of blocks) {
    if (isToolCallBlock(block)) {
      open += 1
    } else if (isToolResultBlock(block)) {
      open = Math.max(0, open - 1)
    }
  }
  return open
}

/** Calls the Claude app keeps out of tool groups, each a row of its own
 *  ("Proposed plan", "Asked <header>"; 1.261013.20, the reducer `t5v`), and an
 *  Artifact call its card draws (anything artifactCallView does not call a `row`). */
function standsAlone(call: NativeChatToolCallBlock, next: NativeChatBlock | undefined): boolean {
  return /^(exitplanmode|askuserquestion)$/i.test(call.name.trim()) || artifactCallViewBeside(call, next).kind !== 'row'
}
