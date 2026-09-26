// docs/claude-app-parity.md item 3: a green/red "+A −R" line-count chip on a
// tool run that created or edited a file, the way the Claude app draws it
// beside "Ran 2 commands, created a file". Counts come from the same evidence
// chain the inline diff card (MobileNativeChatDiffCard) already trusts —
// editPatch hunks first, then a whole-file write, then an Edit's own
// old/new strings — never a guess, so a run with no resolvable edit draws
// nothing rather than a false "+0 −0", and a run whose edit the wire cut
// (mobile-native-chat-edit-wire-cut.ts) draws nothing rather than the count
// of what survived the cut.

import { pairToolBlocks } from '../../../src/shared/native-chat-tool-fold'
import {
  editFilesFromToolPair,
  isEditToolName
} from '../../../src/shared/native-chat-edit-normalize'
import type {
  NativeChatBlock,
  NativeChatToolCallBlock,
  NativeChatToolResultBlock
} from '../../../src/shared/native-chat-types'
import {
  editFileCountIsWhole,
  landedEditIsUncountable,
  markWireCutEditFiles,
  type MobileEditFile
} from './mobile-native-chat-edit-wire-cut'

/** The files one call is known to have changed, across every shape the
 *  vendored decoder understands — null when the tool isn't edit-shaped, or
 *  when the call is still running, failed, or has no answer yet. A file whose
 *  rows the wire cut comes back `truncated`, and one whose patch may go on
 *  past its last hunk `mayContinue`. The one place the chip, the
 *  diff card and the sentence's "created a file" wording ask this question,
 *  so they read the same evidence the same way. */
export function editFilesForToolCall(
  call: NativeChatToolCallBlock,
  result: NativeChatToolResultBlock | null
): MobileEditFile[] | null {
  if (!isEditToolName(call.name)) {
    return null
  }
  const files = editFilesFromToolPair({
    name: call.name,
    input: call.input,
    ...(call.state ? { state: call.state } : {}),
    ...(result
      ? { result: { output: result.output, isError: result.isError, editPatch: result.editPatch } }
      : {})
  })
  return files ? markWireCutEditFiles(call, result, files) : null
}

export type NativeChatToolRunDiffStat = { added: number; removed: number }

/** The run's total added/removed line count, summed over every file an
 *  edit-shaped call in the run (not only the rows a collapsed view still
 *  shows) is known to have changed. Null when the run touched no file, or
 *  when any edit in it landed without a whole count — a cut file, or an edit
 *  with nothing left to count. A sum that leaves one out is not the run's
 *  total, so there is nothing honest to draw. */
export function toolRunDiffStat(
  blocks: readonly NativeChatBlock[]
): NativeChatToolRunDiffStat | null {
  let added = 0
  let removed = 0
  let counted = false
  for (const pair of pairToolBlocks(blocks)) {
    if (!pair.call) {
      continue
    }
    const result = pair.result ?? null
    const files = editFilesForToolCall(pair.call, result)
    if (!files || files.length === 0) {
      if (landedEditIsUncountable(pair.call, result)) {
        return null
      }
      continue
    }
    for (const file of files) {
      if (!editFileCountIsWhole(file)) {
        return null
      }
      added += file.added
      removed += file.removed
    }
    counted = true
  }
  return counted ? { added, removed } : null
}
