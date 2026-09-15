import {
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatBlock
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
 * Nothing is dropped and nothing is reordered; concatenating the segments gives
 * the input back unchanged, which its test pins.
 */
export function splitTurnIntoSegments(
  blocks: readonly NativeChatBlock[]
): NativeChatTurnSegment[] {
  const segments: NativeChatTurnSegment[] = []
  for (const block of blocks) {
    const kind: NativeChatTurnSegment['kind'] =
      isToolCallBlock(block) || isToolResultBlock(block) ? 'tools' : 'prose'
    const open = segments.at(-1)
    if (open?.kind === kind) {
      open.blocks.push(block)
    } else {
      segments.push({ kind, blocks: [block] })
    }
  }
  return segments
}
