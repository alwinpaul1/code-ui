import { pairToolBlocks } from '../../../src/shared/native-chat-tool-fold'
import type {
  NativeChatMessage,
  NativeChatToolCallBlock,
  NativeChatToolResultBlock
} from '../../../src/shared/native-chat-types'
import { editFileCountIsWhole, landedEditIsUncountable, type MobileEditFile } from './mobile-native-chat-edit-wire-cut'
import type { NativeChatToolRunDiffStat } from './mobile-native-chat-tool-run-diff-stat'
import { editFilesForToolCall } from './mobile-native-chat-tool-run-diff-stat'

/**
 * The files one agent turn changed, for the card the Claude app 1.261009.20
 * draws under a finished turn (`ccr_turn_edits_*`, h130): "Edited X" or
 * "Created X" with its "+A −R" pill and Review, one row per file past one,
 * three rows and then "Show N more".
 *
 * The evidence is the tool-run chip's (mobile-native-chat-tool-run-diff-stat.ts):
 * a call that landed and is edit-shaped. A file's count is drawn only when
 * every change to it is whole; one the wire cut keeps its row and loses its
 * pill rather than show the part that survived. A landed edit with no rows at
 * all (landedEditIsUncountable) withholds the whole card. Codex 0.153.4 applies patches
 * inside its `exec` script, which nothing splits into files, so a Codex turn
 * gets no card rather than an invented one.
 */
export type TurnEditedFile = {
  path: string
  /** The turn's first change to it made the file. */
  created: boolean
  /** Lines added and removed over the turn, or null when any change is cut. */
  stat: NativeChatToolRunDiffStat | null
  /** Each change, oldest first, as the transcript's diff cards draw it. */
  changes: MobileEditFile[]
}

/** One call's files, worked out once per call: the fold clones a row each
 *  time a record joins it, but hands the same call and result blocks along,
 *  so a turn re-read on every transcript update reuses them. */
const CALL_FILES = new WeakMap<
  NativeChatToolCallBlock,
  { result: NativeChatToolResultBlock | null; files: TurnEditedFile[] | 'uncountable' }
>()

function callEditedFiles(
  call: NativeChatToolCallBlock,
  result: NativeChatToolResultBlock | null
): TurnEditedFile[] | 'uncountable' {
  const cached = CALL_FILES.get(call)
  if (cached && cached.result === result) {
    return cached.files
  }
  const edits = editFilesForToolCall(call, result)
  const files: TurnEditedFile[] | 'uncountable' =
    !edits || edits.length === 0
      ? landedEditIsUncountable(call, result)
        ? 'uncountable'
        : []
      : edits.map((file) => ({
          path: file.path,
          created: file.changeKind === 'added',
          stat: editFileCountIsWhole(file) ? { added: file.added, removed: file.removed } : null,
          changes: [file]
        }))
  CALL_FILES.set(call, { result, files })
  return files
}

export function turnEditedFiles(rows: readonly NativeChatMessage[]): TurnEditedFile[] {
  const byPath = new Map<string, TurnEditedFile>()
  for (const row of rows) {
    for (const pair of pairToolBlocks(row.blocks)) {
      if (!pair.call) {
        continue
      }
      const files = callEditedFiles(pair.call, pair.result ?? null)
      // A landed edit the phone cannot read: a list without it, and a total,
      // would claim the turn changed less than it did. The run's chip draws
      // no count for it either.
      if (files === 'uncountable') {
        return []
      }
      for (const file of files) {
        const entry = byPath.get(file.path)
        if (!entry) {
          byPath.set(file.path, { ...file, changes: [...file.changes] })
          continue
        }
        entry.changes.push(...file.changes)
        entry.stat =
          entry.stat && file.stat
            ? { added: entry.stat.added + file.stat.added, removed: entry.stat.removed + file.stat.removed }
            : null
      }
    }
  }
  return [...byPath.values()]
}

/** Whether two readings of a turn's files draw the same card: the list
 *  re-reads every turn on each transcript update, and a row handed a new but
 *  equal list would re-render for nothing. */
export function sameTurnEdits(a: readonly TurnEditedFile[], b: readonly TurnEditedFile[]): boolean {
  return (
    a.length === b.length &&
    a.every((file, index) => {
      const other = b[index]!
      return (
        file.path === other.path &&
        file.created === other.created &&
        file.stat?.added === other.stat?.added &&
        file.stat?.removed === other.stat?.removed &&
        file.changes.length === other.changes.length &&
        file.changes.every((change, at) => sameChange(change, other.changes[at]!))
      )
    })
  )
}

/** The fold hands back new objects for the same records, so a change is
 *  compared by what its diff card draws, not by identity. */
function sameChange(a: MobileEditFile, b: MobileEditFile): boolean {
  return (
    a === b ||
    (a.path === b.path &&
      a.changeKind === b.changeKind &&
      a.added === b.added &&
      a.removed === b.removed &&
      a.truncated === b.truncated &&
      a.lines.length === b.lines.length &&
      JSON.stringify(a.lines) === JSON.stringify(b.lines))
  )
}

export function fileBaseName(path: string): string {
  return path.split(/[\\/]/).at(-1) || path
}

/** The card's heading: the file for one ("Edited run.sh", `ccr_turn_edits_single_file`),
 *  the run sentence's words for several ("Edited 2 files, created a file"). */
export function turnEditsTitle(files: readonly TurnEditedFile[]): string {
  if (files.length === 1) {
    const [only] = files
    return `${only!.created ? 'Created' : 'Edited'} ${fileBaseName(only!.path)}`
  }
  const created = files.filter((file) => file.created).length
  const edited = files.length - created
  const parts = [
    edited > 0 ? (edited === 1 ? 'edited a file' : `edited ${edited} files`) : null,
    created > 0 ? (created === 1 ? 'created a file' : `created ${created} files`) : null
  ].filter((part): part is string => part !== null)
  const sentence = parts.join(', ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

/** The turn's total, or null when any file's count is unknown. */
export function turnEditsStat(files: readonly TurnEditedFile[]): NativeChatToolRunDiffStat | null {
  let added = 0
  let removed = 0
  for (const file of files) {
    if (!file.stat) {
      return null
    }
    added += file.stat.added
    removed += file.stat.removed
  }
  return { added, removed }
}

/** Rows the card lists before "Show N more" (`ccr_turn_edits_show_more`). */
export const TURN_EDITS_FOLDED_ROWS = 3
