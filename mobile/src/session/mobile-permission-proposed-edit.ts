/**
 * The change an agent is asking permission to make, read out of the approval
 * itself so the card can show the diff BEFORE the user accepts — the way the
 * VS Code extension does — instead of after the edit has landed.
 *
 * Only the SDK lane carries enough to do this. Its `detail` is the tool input
 * as the host stringified it: Orca 1.4.205 (`out/main/index.js`) builds a
 * Claude `canUseTool` prompt as `{ title: "Allow <tool>?", detail:
 * JSON.stringify(input) }` and a Codex `item/fileChange/requestApproval` as
 * `{ title: "Apply file changes?", detail: JSON.stringify(changes) }`, both
 * through a 16 KiB head bound (`inlineHeadBytes: 16*1024`) that appends
 * `\n[Orca: output truncated — N bytes total, digest …]` when it clipped.
 *
 * The TUI lane has nothing to offer here and gets nothing: the Claude screen
 * parser is anchored on `Bash command`, the hook envelope's summary for an
 * Edit is the file path alone, and Codex's dialog parser reads command
 * prompts only. A clipped payload gets nothing too — half an edit shown as
 * the whole of it is worse than the raw text.
 */
import type { NativeChatEditFile } from '../../../src/shared/native-chat-edit-model'
import { editFilesFromToolPair } from '../../../src/shared/native-chat-edit-normalize'

export type ProposedEditFile = {
  file: NativeChatEditFile
  /** Header verb, present tense: nothing has been applied yet. */
  verb: string
}

export type ProposedEditPreview =
  | { kind: 'diff'; files: ProposedEditFile[] }
  /** The host clipped the input before it reached the phone. `path` is the
   *  target when the head still held it; `totalBytes` is the host's own count. */
  | { kind: 'truncated'; path: string | null; totalBytes: number | null }
  | { kind: 'none' }

// `NotebookEdit` is deliberately absent: its input carries only the new cell
// source, so a preview would paint an unchanged cell as wholly added.
const CLAUDE_EDIT_TITLE = /^Allow (Edit|Write|MultiEdit)\?$/
const CODEX_FILE_CHANGE_TITLE = 'Apply file changes?'
// The host's marker, verbatim. JSON.stringify output never holds a raw newline
// outside a string, so this cannot match inside an intact payload.
const ORCA_TRUNCATION_MARKER = /\n\[Orca: output truncated — (\d+) bytes total, digest [0-9a-f]+\]\s*$/
// A clipped head still names the file when the cut fell past it. Claude's
// edit inputs open with `file_path`; Codex's detail is an array whose first
// change carries `path` after zero or more scalar fields. Both are matched on
// JSON's own escaping, so the recovered path is exact or absent, never partial.
const JSON_STRING = '"(?:[^"\\\\]|\\\\.)*"'
const JSON_SCALAR_FIELD = `${JSON_STRING}:(?:${JSON_STRING}|-?\\d+(?:\\.\\d+)?|true|false|null),`
const LEADING_FILE_PATH = new RegExp(`^\\{"file_path":(${JSON_STRING})`)
const LEADING_CODEX_PATH = new RegExp(`^\\[\\{(?:${JSON_SCALAR_FIELD})*"path":(${JSON_STRING})`)

const CODEX_VERB: Record<NativeChatEditFile['changeKind'], string> = {
  added: 'New file',
  deleted: 'Deletes file',
  renamed: 'Renames file',
  edited: 'Proposed edit'
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function truncatedPreview(detail: string, marker: RegExpMatchArray): ProposedEditPreview {
  const head = detail.slice(0, marker.index)
  const literal = head.match(LEADING_FILE_PATH)?.[1] ?? head.match(LEADING_CODEX_PATH)?.[1]
  // Undo JSON's escaping by parsing the string literal on its own.
  const path = literal === undefined ? null : (parseJson(literal) as string | undefined)
  const totalBytes = Number.parseInt(marker[1] ?? '', 10)
  return {
    kind: 'truncated',
    path: typeof path === 'string' && path.length > 0 ? path : null,
    totalBytes: Number.isFinite(totalBytes) ? totalBytes : null
  }
}

/** The vendored normaliser gates on evidence that an edit LANDED, because a
 *  transcript card states the edit as made. Here the header says "Proposed",
 *  so the gate is passed deliberately to reach the one diff model both cards
 *  share; nothing else about the call claims the edit happened. */
function normalise(name: string, input: unknown): NativeChatEditFile[] {
  const files = editFilesFromToolPair({ name, input, state: 'completed' }) ?? []
  // An empty snippet pair or an empty write yields a file with no rows; a
  // header over nothing says less than the raw request does.
  return files.filter((file) => file.lines.length > 0)
}

function claudePreview(tool: string, input: unknown): ProposedEditPreview {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { kind: 'none' }
  }
  const files = normalise(tool, input)
  if (files.length === 0) {
    return { kind: 'none' }
  }
  // A Write is the whole new content and nothing else: the file's current
  // contents are not on the wire, and whether it exists at all is unknown
  // before approval, so the label says what the tool does and no more.
  // "Replaces" would claim a file that may not be there.
  const verb = tool === 'Write' ? 'Writes file' : 'Proposed edit'
  return { kind: 'diff', files: files.map((file) => ({ file, verb })) }
}

function codexPreview(changes: unknown): ProposedEditPreview {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { kind: 'none' }
  }
  // Any name outside the patch and Claude tool sets reaches the `changes`
  // branch of the normaliser and nothing else.
  const files = normalise('codex-file-change', { changes })
  if (files.length === 0) {
    return { kind: 'none' }
  }
  return {
    kind: 'diff',
    files: files.map((file) => ({ file, verb: CODEX_VERB[file.changeKind] }))
  }
}

export type FoldedProposedFiles = {
  files: ProposedEditFile[]
  totalRows: number
  hiddenRows: number
}

/** The first `budget` rows across the files, in order, with the header counts
 *  left describing the whole change. The card sits in the dock, so a long edit
 *  opens folded and the user asks for the rest; the split is a slice, not the
 *  post-apply card's row cap, so nothing reads as "truncated" while a tap
 *  away. */
export function foldProposedFiles(files: ProposedEditFile[], budget: number): FoldedProposedFiles {
  const totalRows = files.reduce((sum, entry) => sum + entry.file.lines.length, 0)
  if (totalRows <= budget) {
    return { files, totalRows, hiddenRows: 0 }
  }
  const folded: ProposedEditFile[] = []
  let remaining = budget
  for (const entry of files) {
    if (remaining <= 0) {
      break
    }
    const lines = entry.file.lines.slice(0, remaining)
    remaining -= lines.length
    folded.push({ ...entry, file: { ...entry.file, lines } })
  }
  return { files: folded, totalRows, hiddenRows: totalRows - budget }
}

export function proposedEditPreview(
  title: string,
  detail: string | undefined
): ProposedEditPreview {
  const claudeTool = title.match(CLAUDE_EDIT_TITLE)?.[1]
  const codex = title === CODEX_FILE_CHANGE_TITLE
  if ((!claudeTool && !codex) || !detail) {
    return { kind: 'none' }
  }
  const marker = detail.match(ORCA_TRUNCATION_MARKER)
  if (marker) {
    return truncatedPreview(detail, marker)
  }
  const parsed = parseJson(detail)
  if (parsed === undefined) {
    return { kind: 'none' }
  }
  return claudeTool ? claudePreview(claudeTool, parsed) : codexPreview(parsed)
}
