// docs/claude-app-parity.md item 3: a line count the wire cut is no count.
//
// The run's "+A −R" chip and the diff card's header count the rows an edit
// resolves to. Before the phone sees an edit, three things can cut those rows
// short without changing how the survivors look:
//
// - Orca's mobile payload diet (native-chat-rpc-block-sanitize.ts,
//   `sanitizeToolInput`; origin/main 8d6fec597b and the installed 1.4.211)
//   keeps 4000 characters of a tool call's input, across all its strings. It
//   ends every string it cut with `… (truncated)`, puts the same words in
//   place of a value it dropped, and a `'…': 'truncated'` key in place of keys
//   it dropped. A Claude Write keeps its lines nowhere else: a create's
//   `structuredPatch` is empty (3658 of the 3658 creates in this machine's
//   Claude Code transcripts, 2026-09-26), and 1421 of those creates were over
//   the budget. No RPC the phone may call returns the uncut input.
// - Orca's Claude decoder (transcript-line-decoders-claude.ts) keeps at most
//   40 hunks of a result's `structuredPatch`, and 400 rows of each.
// - The structured journal bounds a patch or an input and says so; the
//   vendored readers already mark those files `truncated`, or find no file.
//
// A file whose rows were cut is marked `truncated`, as the vendored readers
// mark theirs, and hunk revert keeps refusing what a cut may have split. A
// file whose rows are whole but whose patch may go on past them is marked
// `mayContinue`. The chip and the card read either as "no count": what is
// drawn is known, what is missing is said to be missing, and no number stands
// in for it.

import type { NativeChatEditFile } from '../../../src/shared/native-chat-edit-model'
import { stripBoundedTextMarker } from '../../../src/shared/structured-agent-session-projection'
import type {
  NativeChatEditPatchHunk,
  NativeChatToolCallBlock,
  NativeChatToolResultBlock
} from '../../../src/shared/native-chat-types'

/** An edit file as the chat draws it: the vendored file, and whether more of
 *  its patch may follow the last hunk the phone was given. */
export type MobileEditFile = NativeChatEditFile & { mayContinue?: true }

/** What the mobile diet leaves at the end of a string it cut, and in place of
 *  a value it dropped. */
const MOBILE_CUT = '… (truncated)'
/** The key the mobile diet leaves in place of keys it dropped. */
const MOBILE_DROPPED_KEYS = '…'
/** Orca's MAX_EDIT_PATCH_HUNKS: a patch this long may have lost the rest. */
const ORCA_EDIT_PATCH_HUNK_CAP = 40
/** The diet replaces anything below depth 5, so no mark sits deeper. */
const MAX_CUT_DEPTH = 6

/** Tools whose every landing changed a file. No provider Orca decodes sends a
 *  tool named `str_replace`, so its shape, and whether it edited, is unknown. */
const FILE_EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'apply_patch'])
/** Command tools, which apply a patch only when they say so (the vendored
 *  COMMAND_PATCH_TOOLS). */
const COMMAND_PATCH_TOOLS = new Set(['exec', 'shell', 'local_shell'])
const BEGIN_PATCH = '*** Begin Patch'
const APPLY_PATCH = /apply_?patch/

function carriesMobileCut(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') {
    return value.endsWith(MOBILE_CUT)
  }
  if (typeof value !== 'object' || value === null || depth >= MAX_CUT_DEPTH) {
    return false
  }
  if (Array.isArray(value)) {
    return value.some((entry) => carriesMobileCut(entry, depth + 1))
  }
  return (
    Object.hasOwn(value, MOBILE_DROPPED_KEYS) ||
    Object.values(value).some((entry) => carriesMobileCut(entry, depth + 1))
  )
}

/** A hunk Orca cut has fewer rows than its own header counts. Checked against
 *  all 12,265 hunks in this machine's Claude Code transcripts (2.1.205 to
 *  2.1.282, 2026-09-26): every one of them adds up, and 14 are over 400 rows. */
function hunkIsWhole(hunk: NativeChatEditPatchHunk): boolean {
  let context = 0
  let added = 0
  let removed = 0
  for (const row of hunk.lines) {
    if (row.startsWith('+')) {
      added += 1
    } else if (row.startsWith('-')) {
      removed += 1
    } else if (!row.startsWith('\\')) {
      // `\ No newline at end of file` belongs to neither side.
      context += 1
    }
  }
  return context + removed === hunk.oldLines && context + added === hunk.newLines
}

/** Marks what `editFilesFromToolPair` resolved, read in the order it reads
 *  its evidence: resolved hunks when there are any, the call's input
 *  otherwise. */
export function markWireCutEditFiles(
  call: NativeChatToolCallBlock,
  result: NativeChatToolResultBlock | null,
  files: NativeChatEditFile[]
): MobileEditFile[] {
  const hunks = result?.editPatch?.hunks ?? []
  const cut = hunks.length > 0 ? !hunks.every(hunkIsWhole) : carriesMobileCut(call.input)
  if (cut) {
    return files.map((file) => (file.truncated ? file : { ...file, truncated: true }))
  }
  if (hunks.length >= ORCA_EDIT_PATCH_HUNK_CAP) {
    return files.map((file) => ({ ...file, mayContinue: true }))
  }
  return files
}

/** Whether a file's own "+A −R" is the edit's count. */
export function editFileCountIsWhole(file: MobileEditFile): boolean {
  return !file.truncated && file.mayContinue !== true
}

function landed(call: NativeChatToolCallBlock, result: NativeChatToolResultBlock | null): boolean {
  // The rule `editFilesFromToolPair` holds its cards to: reported complete,
  // or answered with a result that is not an error.
  if (call.state === 'failed' || call.state === 'running' || result?.isError === true) {
    return false
  }
  return call.state === 'completed' || result !== null
}

/** A call that landed an edit the phone has no rows for, so a run holding one
 *  has no total: a file-editing tool whose edit the wire took, a Codex diff
 *  the journal bounded before its first hunk, or a Codex command that applied
 *  a patch whose envelope was cut or is written as a script string. A diff
 *  with no hunks at all only moved a file, and a command that ran no patch
 *  changed nothing the phone could count either way. */
export function landedEditIsUncountable(
  call: NativeChatToolCallBlock,
  result: NativeChatToolResultBlock | null
): boolean {
  if (!landed(call, result)) {
    return false
  }
  if (FILE_EDIT_TOOLS.has(call.name)) {
    return true
  }
  if (call.name === 'Diff') {
    return result !== null && stripBoundedTextMarker(result.output).truncated
  }
  if (!COMMAND_PATCH_TOOLS.has(call.name)) {
    return false
  }
  const text = typeof call.input === 'string' ? call.input : JSON.stringify(call.input ?? null)
  return text.includes(BEGIN_PATCH) && APPLY_PATCH.test(text)
}
