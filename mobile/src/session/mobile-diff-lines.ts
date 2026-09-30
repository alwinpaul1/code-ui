import { emitMobileDiffRows } from './mobile-diff-rows'
import { alignDiffSegments } from './mobile-diff-segments'

export type MobileDiffLineKind = 'context' | 'add' | 'delete'

/** Set on a row that stands for something other than a line of the file (mobile-diff-notes.ts). */
export type MobileDiffLineNote =
  // A run of unchanged lines folded away in a diff too long to draw whole.
  | { kind: 'collapsed'; hiddenLines: number }
  // The rows the mobile cap left out, by kind of change.
  | { kind: 'truncated'; hiddenAdded: number; hiddenDeleted: number }

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
  const originalLines = splitContentLines(originalContent)
  const modifiedLines = splitContentLines(modifiedContent)
  // Why: the LCS table is quadratic. Large generated files still need a responsive mobile
  // preview, so larger files are aligned by Myers' O(ND), then as one replaced block
  // (mobile-diff-segments.ts); long unchanged runs fold before the row cap (mobile-diff-rows.ts).
  return emitMobileDiffRows(
    alignDiffSegments(originalLines, modifiedLines),
    originalLines,
    modifiedLines
  )
}

function splitContentLines(content: string): string[] {
  if (content.length === 0) {
    return []
  }
  const lines = content.split(/\r?\n/)
  if (content.endsWith('\n')) {
    lines.pop()
  }
  return lines
}
