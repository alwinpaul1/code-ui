import { lineEndingsDiffRow } from './mobile-diff-notes'
import { emitMobileDiffRows } from './mobile-diff-rows'
import { alignDiffSegments } from './mobile-diff-segments'

export type MobileDiffLineKind = 'context' | 'add' | 'delete'

/** How a file ends its lines; 'none' is a file with no newline at all. */
export type MobileLineEndings = 'crlf' | 'lf' | 'mixed' | 'none'

/** Set on a row that stands for something other than a line of the file (mobile-diff-notes.ts). */
export type MobileDiffLineNote =
  // A run of unchanged lines folded away in a diff too long to draw whole.
  | { kind: 'collapsed'; hiddenLines: number }
  // The rows the mobile cap left out, by kind of change.
  | { kind: 'truncated'; hiddenAdded: number; hiddenDeleted: number }
  // git's "\ No newline at end of file", after the changed row whose side lacks it.
  | { kind: 'no-newline' }
  // The files end their lines differently; `only` when that is the whole change.
  | { kind: 'line-endings'; from: MobileLineEndings; to: MobileLineEndings; only: boolean }

export type MobileDiffLine = {
  kind: MobileDiffLineKind
  text: string
  oldLineNumber?: number
  newLineNumber?: number
  note?: MobileDiffLineNote
}

export function buildMobileDiffLines(
  originalContent: string,
  modifiedContent: string
): { lines: MobileDiffLine[]; truncated: boolean } {
  const original = splitContent(originalContent)
  const modified = splitContent(modifiedContent)
  // Why: the LCS table is quadratic. Large generated files still need a responsive mobile
  // preview, so larger files are aligned by Myers' O(ND), then as one replaced block
  // (mobile-diff-segments.ts); long unchanged runs fold before the row cap (mobile-diff-rows.ts).
  const result = emitMobileDiffRows(
    alignDiffSegments(original.keys, modified.keys),
    original.lines,
    modified.lines,
    { oldUnterminated: original.unterminated, newUnterminated: modified.unterminated }
  )
  // Lines are compared without their CR, so a content edit in a CRLF file diffs by content; what
  // that hides (the endings themselves) is said once, above the rows.
  const changed = result.lines.some((line) => line.kind !== 'context')
  const endingsDiffer =
    original.endings !== modified.endings &&
    original.endings !== 'none' &&
    modified.endings !== 'none'
  if (!changed && originalContent !== modifiedContent) {
    return {
      ...result,
      lines: [lineEndingsDiffRow(original.endings, modified.endings, true), ...result.lines]
    }
  }
  if (endingsDiffer) {
    return {
      ...result,
      lines: [lineEndingsDiffRow(original.endings, modified.endings, false), ...result.lines]
    }
  }
  return result
}

type SplitContent = {
  // What each row shows.
  lines: string[]
  // What rows are compared by: the lines, with the last one marked when it has no newline, so
  // 'b' at the end of a file and 'b\n' there differ the way git says they do. A line never holds
  // '\n' (the split takes them all), so the mark cannot collide with a real line.
  keys: string[]
  unterminated: boolean
  endings: MobileLineEndings
}

function splitContent(content: string): SplitContent {
  if (content.length === 0) {
    return { lines: [], keys: [], unterminated: false, endings: 'none' }
  }
  const lines = content.split(/\r?\n/)
  const unterminated = !content.endsWith('\n')
  if (!unterminated) {
    lines.pop()
  }
  const keys = unterminated ? [...lines.slice(0, -1), `${lines[lines.length - 1]}\n`] : lines
  return { lines, keys, unterminated, endings: lineEndingsOf(content) }
}

function lineEndingsOf(content: string): MobileLineEndings {
  const newlines = content.split('\n').length - 1
  const crlf = content.split('\r\n').length - 1
  if (newlines === 0) {
    return 'none'
  }
  return crlf === newlines ? 'crlf' : crlf === 0 ? 'lf' : 'mixed'
}
