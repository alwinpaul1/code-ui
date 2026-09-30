// How many files a run's edits touched, for the run sentence's "Edited N
// files". It counted edit CALLS, so one Codex apply_patch that updated two
// files and added a third read "Edited a file" beside a chip that counted
// three, and two Edits of one file read "Edited 2 files" (review,
// 2026-09-30). Files are now told apart by path, from the same evidence the
// chip reads (editFilesForToolCall), so the two agree.

import { editFilesFromToolPair, isEditToolName } from '../../../src/shared/native-chat-edit-normalize'
import type { NativeChatToolCallBlock, NativeChatToolResultBlock } from '../../../src/shared/native-chat-types'
import { editFilesForToolCall } from './mobile-native-chat-tool-run-diff-stat'

export type ToolRunPair = {
  call: NativeChatToolCallBlock
  result: NativeChatToolResultBlock | null
}

/** The vendored decoder's name for a file it was given no path for
 *  (`claudeEditFiles` in native-chat-edit-normalize.ts). */
const UNNAMED_FILE = 'file'

function ownPath(input: unknown): string | null {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : null
  const path = record ? (record.file_path ?? record.path ?? record.filePath) : undefined
  return typeof path === 'string' && path.trim().length > 0 ? path : null
}

/** The paths one edit-shaped call changed or, when it did not land (failed,
 *  still running, unanswered), the paths it set out to change: first what
 *  landed, then what its own input names, then a lone path field. Empty when
 *  nothing names a file, so two such calls are never taken for one file. */
function editedPaths({ call, result }: ToolRunPair): string[] {
  const own = ownPath(call.input)
  const landed = editFilesForToolCall(call, result)
  const files =
    landed && landed.length > 0
      ? landed
      : isEditToolName(call.name)
        ? (editFilesFromToolPair({ name: call.name, input: call.input, state: 'completed' }) ?? [])
        : []
  const paths = files
    .map((file) => file.path)
    .filter((path) => path.length > 0 && (path !== UNNAMED_FILE || own !== null))
  if (paths.length > 0) {
    return paths
  }
  return own ? [own] : []
}

/** Distinct files across a run's edit calls. A call that names no file counts
 *  as one of its own, never merged with another by a guess. */
export function editedFileCount(pairs: readonly ToolRunPair[]): number {
  const paths = new Set<string>()
  let unnamed = 0
  for (const pair of pairs) {
    const named = editedPaths(pair)
    if (named.length === 0) {
      unnamed += 1
    }
    for (const path of named) {
      paths.add(path)
    }
  }
  return paths.size + unnamed
}

/** True only when a single edit-shaped call's own result is certain the file
 *  is new — a `command: "create"` or a "File created successfully" result,
 *  the same evidence `editFilesFromToolPair` requires of the inline diff
 *  card. Never a guess from the tool name alone. */
export function soleCallCreatedFile({ call, result }: ToolRunPair): boolean {
  const files = editFilesForToolCall(call, result)
  return files !== null && files.length === 1 && files[0]!.changeKind === 'added'
}
