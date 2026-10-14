import type { MobileDiffLine } from '../session/mobile-diff-lines'
import { formatDiffCount } from '../session/mobile-diff-notes'

/**
 * A diff drawn as hunks with a fold between them, the way the Claude app draws it
 * (com.anthropic.claude 1.261009.20: `jye.c` builds the rows, `iye` runs the three taps, `jlc.e`
 * draws a fold).
 *
 * The rows the review gets are the whole file with its changes marked (`buildMobileDiffLines`), so
 * the lines a fold hides are already here: expanding only changes which of them are drawn, and
 * nothing is fetched. What the Claude app reads from `jye.a` on the first tap, this reads from the
 * rows.
 *
 * What the app does, and this keeps to it:
 *
 * - Three unchanged lines stay beside a change (`jye.f`, git's -U3).
 * - A run of unchanged lines between two changes is one fold. Its control is the single "Expand
 *   all" button: both of its flags are set (`z3` and `z2` in `jye.c`), and `jlc.e` turns that pair
 *   into one button.
 * - The run above the first change is a fold with only `canExpandDown`, and the run below the last
 *   one a fold with only `canExpandUp`. Each tap opens three lines beside the change (`iye` cases
 *   1 and 2: `ryh(i20, min(size, i20 + 2))` and `ryh(max(1, i30 - 2), i30)`).
 * - The label is "+N lines" with N the lines still hidden, "Expand" when the count is not known.
 *
 * Two things the app does not have to say, and this does:
 *
 * - A fold that would hide one line is not a fold. The app's count is `k(next) - h(prev) + 1`, so
 *   it can show "+1 lines"; a row standing in for a single row saves nothing, so the line is
 *   drawn (the mobile cap's own fold makes the same choice, mobile-diff-rows.ts).
 * - A line that carries a comment is a change for this purpose. A review note can sit on an
 *   unchanged line, and hiding that line would hide the note.
 *
 * What was opened is kept as the set of raw rows brought back, not as a count per fold. A count
 * hangs on which fold it was given to, and a fold splits when a comment lands inside it (the line
 * is a change now): the rows the reader had opened closed again. A row that was opened stays open
 * whatever the folds around it do.
 */

/** Unchanged lines kept beside a change. */
export const MOBILE_DIFF_CONTEXT_LINES = 3

/** Lines one tap on the top or bottom fold opens. */
export const MOBILE_DIFF_EXPAND_STEP_LINES = 3

export type MobileDiffGapPosition = 'top' | 'between' | 'bottom'

export type MobileDiffGap = {
  /** The raw index of the first hidden row. */
  start: number
  /** The raw index of the last hidden row. */
  end: number
  position: MobileDiffGapPosition
  hiddenLines: number
  /** The app's `qof.b`: lines below the change above can still be opened. */
  canExpandUp: boolean
  /** The app's `qof.c`: lines above the change below can still be opened. */
  canExpandDown: boolean
}

export type MobileDiffDisplayRow<T extends MobileDiffLine> =
  | { kind: 'line'; line: T; rawIndex: number }
  | { kind: 'gap'; gap: MobileDiffGap }

/** The raw rows the reader has brought back from a fold. */
export type MobileDiffExpansion = ReadonlySet<number>

export const NO_MOBILE_DIFF_EXPANSION: MobileDiffExpansion = new Set()

const NO_PINNED: ReadonlySet<number> = new Set()

export type MobileDiffExpandDirection = 'up' | 'down' | 'all'

/** What the control reads to a screen reader: `diff_expand_up`, `diff_expand_down`, `diff_expand_all`. */
export const MOBILE_DIFF_EXPAND_LABELS: Record<MobileDiffExpandDirection, string> = {
  up: 'Expand up',
  down: 'Expand down',
  all: 'Expand all'
}

/** The one control a fold draws, or null for a fold that cannot open either way. */
export function mobileDiffGapAction(
  gap: Pick<MobileDiffGap, 'canExpandUp' | 'canExpandDown'>
): MobileDiffExpandDirection | null {
  if (gap.canExpandUp && gap.canExpandDown) {
    return 'all'
  }
  if (gap.canExpandUp) {
    return 'up'
  }
  return gap.canExpandDown ? 'down' : null
}

/** "+N lines", or "Expand" when nothing is known to be hidden (`jlc.e`, `diff_hidden_lines`). */
export function mobileDiffGapLabel(gap: Pick<MobileDiffGap, 'hiddenLines'>): string {
  return gap.hiddenLines > 0 ? `+${formatDiffCount(gap.hiddenLines)} lines` : 'Expand'
}

/**
 * The expansion after a tap on `gap`: all of it, three rows beside the change above (up), or three
 * beside the change below (down). Up and down take their rows from the end of the fold that touches
 * that change, so a fold with a change on one side only is opened from that side.
 */
export function expandMobileDiffGap(
  expansion: MobileDiffExpansion,
  gap: Pick<MobileDiffGap, 'start' | 'end'>,
  direction: MobileDiffExpandDirection
): MobileDiffExpansion {
  const next = new Set(expansion)
  const from =
    direction === 'all'
      ? gap.start
      : direction === 'up'
        ? gap.start
        : Math.max(gap.start, gap.end - MOBILE_DIFF_EXPAND_STEP_LINES + 1)
  const to =
    direction === 'all'
      ? gap.end
      : direction === 'up'
        ? Math.min(gap.end, gap.start + MOBILE_DIFF_EXPAND_STEP_LINES - 1)
        : gap.end
  for (let raw = from; raw <= to; raw += 1) {
    next.add(raw)
  }
  return next
}

/**
 * A row the fold keeps three lines beside. A change is one, and so are the notes that ride with a
 * change (git's "\ No newline at end of file" and the row a cut diff ends on) and a line that
 * carries a comment. The line-endings note is not: it opens the file, says something about all of
 * it and sits beside no particular change, so counting it kept the first rows on screen for
 * nothing and turned the top fold into a "between" one.
 */
function isAnchor(line: MobileDiffLine, rawIndex: number, pinned: ReadonlySet<number>): boolean {
  return (
    line.kind !== 'context' ||
    line.note?.kind === 'no-newline' ||
    line.note?.kind === 'truncated' ||
    pinned.has(rawIndex)
  )
}

/** Whether a fold can be built at all: there is a change to fold toward, and the rows still hold
 *  every unchanged line (the mobile cap's own fold has already dropped some, which cannot return). */
function canFold(lines: readonly MobileDiffLine[]): boolean {
  let changed = false
  for (const line of lines) {
    if (line.note?.kind === 'collapsed') {
      return false
    }
    if (line.kind !== 'context') {
      changed = true
    }
  }
  return changed
}

/**
 * Whether two loads of a file hold the same rows. A comment save or a reconnect loads the diff
 * again into a new array; what the reader opened is still true of it when no row differs, and is
 * not when one does (the raw indexes then name other lines).
 */
export function sameMobileDiffRows(
  a: readonly MobileDiffLine[],
  b: readonly MobileDiffLine[]
): boolean {
  if (a === b) {
    return true
  }
  if (a.length !== b.length) {
    return false
  }
  return a.every((line, index) => {
    const other = b[index]!
    return (
      line.kind === other.kind &&
      line.text === other.text &&
      line.oldLineNumber === other.oldLineNumber &&
      line.newLineNumber === other.newLineNumber &&
      line.note?.kind === other.note?.kind
    )
  })
}

export function buildMobileDiffDisplayRows<T extends MobileDiffLine>(
  lines: readonly T[],
  expansion: MobileDiffExpansion = NO_MOBILE_DIFF_EXPANSION,
  pinnedRawIndexes: ReadonlySet<number> = NO_PINNED
): {
  rows: MobileDiffDisplayRow<T>[]
  /** The row that draws raw row `rawIndex`; a hidden row maps to the next one drawn. */
  displayIndexOfRaw: (rawIndex: number) => number
} {
  const rows: MobileDiffDisplayRow<T>[] = []
  const drawnAt: (number | undefined)[] = Array.from({ length: lines.length }, () => undefined)
  const drawLine = (rawIndex: number): void => {
    drawnAt[rawIndex] = rows.length
    rows.push({ kind: 'line', line: lines[rawIndex]!, rawIndex })
  }

  if (!canFold(lines)) {
    lines.forEach((_, rawIndex) => drawLine(rawIndex))
  } else {
    const anchor = lines.map((line, rawIndex) => isAnchor(line, rawIndex, pinnedRawIndexes))
    const firstAnchor = anchor.indexOf(true)
    const lastAnchor = anchor.lastIndexOf(true)
    // A row is hidden when it is unchanged, is not within three rows of an anchor, and has not
    // been opened.
    const hidden = lines.map((_, rawIndex) => {
      // A note row is always drawn, whether or not it is an anchor.
      if (anchor[rawIndex] || expansion.has(rawIndex) || lines[rawIndex]!.note !== undefined) {
        return false
      }
      for (let near = 1; near <= MOBILE_DIFF_CONTEXT_LINES; near += 1) {
        if (anchor[rawIndex - near] || anchor[rawIndex + near]) {
          return false
        }
      }
      return true
    })

    let index = 0
    while (index < lines.length) {
      if (!hidden[index]) {
        drawLine(index)
        index += 1
        continue
      }
      let end = index
      while (end + 1 < lines.length && hidden[end + 1]) {
        end += 1
      }
      const hiddenLines = end - index + 1
      if (hiddenLines <= 1) {
        // One row would be replaced by a row saying "+1 lines": draw the line.
        drawLine(index)
      } else {
        const position: MobileDiffGapPosition =
          index < firstAnchor ? 'top' : end > lastAnchor ? 'bottom' : 'between'
        rows.push({
          kind: 'gap',
          gap: {
            start: index,
            end,
            position,
            hiddenLines,
            canExpandUp: position !== 'top',
            canExpandDown: position !== 'bottom'
          }
        })
      }
      index = end + 1
    }
  }

  // Forward-fill from the back: a raw row that is not drawn maps to the next one that is.
  const mapped: number[] = Array.from({ length: lines.length }, () => Math.max(0, rows.length - 1))
  let next = Math.max(0, rows.length - 1)
  for (let raw = lines.length - 1; raw >= 0; raw -= 1) {
    next = drawnAt[raw] ?? next
    mapped[raw] = next
  }
  return {
    rows,
    displayIndexOfRaw: (rawIndex: number) =>
      mapped[Math.min(Math.max(0, rawIndex), mapped.length - 1)] ?? 0
  }
}
