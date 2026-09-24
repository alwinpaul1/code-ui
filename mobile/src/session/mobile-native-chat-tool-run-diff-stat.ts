// docs/claude-app-parity.md item 3: a green/red "+A −R" line-count chip on a
// tool run that created or edited a file, the way the Claude app draws it
// beside "Ran 2 commands, created a file". Counts come from the same evidence
// chain the inline diff card (MobileNativeChatDiffCard) already trusts —
// editPatch hunks first, then a whole-file write, then an Edit's own
// old/new strings — never a guess, so a run with no resolvable edit draws
// nothing rather than a false "+0 −0".

import { pairToolBlocks } from '../../../src/shared/native-chat-tool-fold'
import {
  editFilesFromToolPair,
  isEditToolName
} from '../../../src/shared/native-chat-edit-normalize'
import type { NativeChatEditFile } from '../../../src/shared/native-chat-edit-model'
import type {
  NativeChatBlock,
  NativeChatToolCallBlock,
  NativeChatToolResultBlock
} from '../../../src/shared/native-chat-types'

/** The files one call is known to have changed, across every shape the
 *  vendored decoder understands — null when the tool isn't edit-shaped, or
 *  when the call is still running, failed, or has no answer yet. The one
 *  place both `toolRunDiffStat` and the sentence's "created a file" wording
 *  ask this question, so they read the same evidence the same way. */
export function editFilesForToolCall(
  call: NativeChatToolCallBlock,
  result: NativeChatToolResultBlock | null
): NativeChatEditFile[] | null {
  if (!isEditToolName(call.name)) {
    return null
  }
  return editFilesFromToolPair({
    name: call.name,
    input: call.input,
    ...(call.state ? { state: call.state } : {}),
    ...(result
      ? { result: { output: result.output, isError: result.isError, editPatch: result.editPatch } }
      : {})
  })
}

function knownEditFiles(blocks: readonly NativeChatBlock[]): NativeChatEditFile[] {
  const files: NativeChatEditFile[] = []
  for (const pair of pairToolBlocks(blocks)) {
    if (!pair.call) {
      continue
    }
    const found = editFilesForToolCall(pair.call, pair.result ?? null)
    if (found) {
      files.push(...found)
    }
  }
  return files
}

export type NativeChatToolRunDiffStat = { added: number; removed: number }

/** The run's total added/removed line count, summed over every file an
 *  edit-shaped call in the run (not only the rows a collapsed view still
 *  shows) is known to have changed. Null when the run touched no file, or
 *  touched one and nothing about the change could be resolved — there is
 *  nothing honest to draw either way. */
export function toolRunDiffStat(
  blocks: readonly NativeChatBlock[]
): NativeChatToolRunDiffStat | null {
  const files = knownEditFiles(blocks)
  if (files.length === 0) {
    return null
  }
  let added = 0
  let removed = 0
  for (const file of files) {
    added += file.added
    removed += file.removed
  }
  return { added, removed }
}
