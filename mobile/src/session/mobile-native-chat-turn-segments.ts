import {
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatBlock,
  type NativeChatToolResultBlock
} from '../../../src/shared/native-chat-types'

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
 * tool groups: "Proposed plan" and "Asked <header>" rows (2026-10-15).
 *
 * Nothing is dropped and nothing is reordered; concatenating the segments gives
 * the input back unchanged, which its test pins.
 */
export function splitTurnIntoSegments(
  blocks: readonly NativeChatBlock[]
): NativeChatTurnSegment[] {
  const segments: NativeChatTurnSegment[] = []
  // The segment that holds a lone plan or question call, while its answer may
  // still come; any other block closes it.
  let standalone: NativeChatTurnSegment | null = null
  for (const block of blocks) {
    const kind: NativeChatTurnSegment['kind'] =
      isToolCallBlock(block) || isToolResultBlock(block) ? 'tools' : 'prose'
    if (isToolCallBlock(block) && standsAlone(block.name)) {
      standalone = { kind, blocks: [block] }
      segments.push(standalone)
      continue
    }
    if (standalone && isToolResultBlock(block) && answers(standalone.blocks, block)) {
      standalone.blocks.push(block)
      standalone = null
      continue
    }
    const open = segments.at(-1)
    if (open?.kind === kind && !closedStandalone(open)) {
      open.blocks.push(block)
    } else {
      segments.push({ kind, blocks: [block] })
    }
    standalone = null
  }
  return segments
}

/** Tools the Claude app keeps out of tool groups, each a row of its own
 *  ("Proposed plan", "Asked <header>"; 1.261013.20, the reducer `t5v`). */
function standsAlone(name: string): boolean {
  return /^(exitplanmode|askuserquestion)$/i.test(name.trim())
}

/** Whether `result` is the answer to the lone call that opens `held`: no
 *  answer yet, and the ids agree where both carry one. */
function answers(held: readonly NativeChatBlock[], result: NativeChatToolResultBlock): boolean {
  const call = held[0]
  if (held.length !== 1 || !call || !isToolCallBlock(call)) {
    return false
  }
  return call.callId === undefined || result.callId === undefined || call.callId === result.callId
}

/** A plan or question row, answered or not: nothing else joins it. */
function closedStandalone(segment: NativeChatTurnSegment): boolean {
  const first = segment.blocks[0]
  return first !== undefined && isToolCallBlock(first) && standsAlone(first.name)
}
