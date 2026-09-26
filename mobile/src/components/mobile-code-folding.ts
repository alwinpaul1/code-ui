import { lineIndents } from './mobile-code-indent'
import type { FileReaderLineRange } from '../session/mobile-file-reader-line-selection'

/**
 * A block the code viewer can fold. 0-based and inclusive: `start` is the
 * header that stays on show, `end` the last line folding it hides. `indent`
 * is the header's, in columns.
 */
export type CodeFoldRegion = { start: number; end: number; indent: number }

/** Monaco's `editor.foldingMaximumRegions` default. */
export const CODE_VIEW_MAX_FOLD_REGIONS = 5_000

/**
 * The blocks a file folds into, by indentation: Monaco's `computeRanges`
 * (vs/editor/contrib/folding/browser/indentRangeProvider.ts), the desktop
 * editor's folding wherever no language provides its own, ported line for
 * line without the `#region` markers. Walking up from the last line, a line
 * whose next non-blank line is indented deeper starts a block that ends
 * before the next line at its indent or less. A blank line inside a block
 * belongs to it; in an off-side language (Python, YAML) a blank line
 * between blocks goes with the block below, so a function does not fold
 * the blank lines under it. Past `limit` blocks the outermost are kept, as
 * Monaco's RangesCollector keeps them.
 */
export function computeFoldRegions(
  lines: readonly string[],
  options: { tabWidth: number; offSide: boolean; limit?: number; indents?: Int32Array }
): CodeFoldRegion[] {
  const { tabWidth, offSide, limit = CODE_VIEW_MAX_FOLD_REGIONS } = options
  // The document's indents, read once (mobile-code-indent's lineIndents).
  const indents = options.indents ?? lineIndents(lines, tabWidth)
  // Monaco's lines are 1-based; `endAbove` is the line below a block's end.
  const found: CodeFoldRegion[] = []
  const previousRegions: { indent: number; endAbove: number }[] = [{ indent: -1, endAbove: lines.length + 1 }]
  for (let line = lines.length; line > 0; line -= 1) {
    const indent = indents[line - 1]!
    let previous = previousRegions[previousRegions.length - 1]!
    if (indent < 0) {
      if (offSide) {
        previous.endAbove = line
      }
      continue
    }
    if (previous.indent > indent) {
      do {
        previousRegions.pop()
        previous = previousRegions[previousRegions.length - 1]!
      } while (previous.indent > indent)
      const endLineNumber = previous.endAbove - 1
      if (endLineNumber - line >= 1) {
        found.push({ start: line - 1, end: endLineNumber - 1, indent })
      }
    }
    if (previous.indent === indent) {
      previous.endAbove = line
    } else {
      previousRegions.push({ indent, endAbove: line })
    }
  }
  found.reverse()
  return found.length <= limit ? found : outermost(found, limit)
}

/** The `limit` outermost blocks, in file order: every block at the lowest
 *  indents, then the first ones at the next indent that still fit. */
function outermost(regions: CodeFoldRegion[], limit: number): CodeFoldRegion[] {
  const indents = [...new Set(regions.map((region) => region.indent))].sort((a, b) => a - b)
  let kept = 0
  let cutIndent = Infinity
  let roomAtCut = 0
  for (const indent of indents) {
    const count = regions.filter((region) => region.indent === indent).length
    if (kept + count > limit) {
      cutIndent = indent
      roomAtCut = limit - kept
      break
    }
    kept += count
  }
  return regions.filter((region) => {
    if (region.indent < cutIndent) {
      return true
    }
    if (region.indent === cutIndent && roomAtCut > 0) {
      roomAtCut -= 1
      return true
    }
    return false
  })
}

/** The lines the list draws, in order: all but the bodies of folded blocks.
 *  `folded` holds the headers (`start`) of the folded blocks. */
export function visibleLineIndices(
  lineCount: number,
  regions: readonly CodeFoldRegion[],
  folded: ReadonlySet<number>
): number[] {
  const hiddenUntil = new Map<number, number>()
  for (const region of regions) {
    if (folded.has(region.start)) {
      hiddenUntil.set(region.start, region.end)
    }
  }
  const visible: number[] = []
  let line = 0
  while (line < lineCount) {
    visible.push(line)
    const end = hiddenUntil.get(line)
    line = end === undefined ? line + 1 : end + 1
  }
  return visible
}

/** The list row a line is drawn on: its own, or the folded header hiding it
 *  (the last drawn line at or above it). */
export function listIndexOfLine(visible: readonly number[], lineIndex: number): number {
  let low = 0
  let high = visible.length - 1
  let found = 0
  while (low <= high) {
    const middle = (low + high) >> 1
    if (visible[middle]! <= lineIndex) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}

/**
 * A line selection (1-based, as the gutter numbers) grown over every folded
 * block whose header it holds, so a selection across a fold, or on a folded
 * header, copies and asks about the hidden lines too: the header stands for
 * the block, as on the desktop.
 */
export function rangeCoveringFolds(
  range: FileReaderLineRange,
  regions: readonly CodeFoldRegion[],
  folded: ReadonlySet<number>
): FileReaderLineRange {
  let end = range.end
  for (const region of regions) {
    const header = region.start + 1
    if (header > end) {
      break
    }
    if (header >= range.start && folded.has(region.start)) {
      end = Math.max(end, region.end + 1)
    }
  }
  return end === range.end ? range : { start: range.start, end }
}
