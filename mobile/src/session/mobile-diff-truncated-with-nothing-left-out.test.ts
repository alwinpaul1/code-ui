// A diff preview that said "truncated" when every changed row was drawn.
//
// A long file is folded (mobile-diff-rows.ts): each unchanged run shrinks to three rows beside each
// change and one "N unchanged lines" row. The unchanged run after the last change was counted
// against the 2,500-row cap like everything else, so when the changed rows ended at or near the
// cap, the cap refused the rows that follow them, and a refused row of any kind meant truncated. A
// 3,000-line file with its first 1,250 lines replaced (2,500 changed rows) and 1,750 unchanged
// lines after them drew every change, then "... diff truncated for mobile preview ..." and the
// footer "Diff truncated for mobile preview.", telling the reviewer changes might be missing when
// none were (review, 2026-09-30, of 67f4f551). Truncated now means a changed row was left out.

import { describe, expect, it } from 'vitest'
import { buildMobileDiffHunks } from './mobile-diff-hunks'
import { buildMobileDiffLines, type MobileDiffLine } from './mobile-diff-lines'
import { describeMobileDiffTruncation } from './mobile-diff-notes'
import { emitMobileDiffRows, MAX_MOBILE_DIFF_LINES } from './mobile-diff-rows'

/** `prefix-first` … `prefix-(first + count - 1)`. */
function numbered(count: number, prefix: string, first = 1): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${first + index}`)
}

function file(lines: string[]): string {
  return `${lines.join('\n')}\n`
}

/** A row as `+12 text`, `-12 text`, ` 12 text` or `[note text]`. */
function shape(line: MobileDiffLine): string {
  if (line.note) {
    return `[${line.text}]`
  }
  const sign = line.kind === 'add' ? '+' : line.kind === 'delete' ? '-' : ' '
  return `${sign}${line.newLineNumber ?? line.oldLineNumber} ${line.text}`
}

function changedRows(lines: readonly MobileDiffLine[]): number {
  return lines.filter((line) => line.kind !== 'context').length
}

/** How many lines of each side the rows stand for, a folded row counting the lines it folds. */
function linesAccountedFor(lines: readonly MobileDiffLine[]): { old: number; new: number } {
  let old = 0
  let next = 0
  for (const line of lines) {
    if (line.note?.kind === 'collapsed') {
      old += line.note.hiddenLines
      next += line.note.hiddenLines
    } else if (!line.note) {
      old += line.kind === 'add' ? 0 : 1
      next += line.kind === 'delete' ? 0 : 1
    }
  }
  return { old, new: next }
}

/** A file of `unchanged + replaced` lines whose first `replaced` lines are rewritten. */
function replacedAtTheTop(replaced: number, unchanged: number) {
  const kept = numbered(unchanged, 'line', replaced + 1)
  const original = [...numbered(replaced, 'old'), ...kept]
  const modified = [...numbered(replaced, 'new'), ...kept]
  return { original, modified, result: buildMobileDiffLines(file(original), file(modified)) }
}

function expectDrawnWhole(
  result: { lines: MobileDiffLine[]; truncated: boolean },
  original: readonly string[],
  modified: readonly string[]
): void {
  expect(result.truncated).toBe(false)
  expect(result.lines.some((line) => line.note?.kind === 'truncated')).toBe(false)
  // Every line of both files is drawn or folded into a row that counts it: nothing dropped quietly.
  expect(linesAccountedFor(result.lines)).toEqual({ old: original.length, new: modified.length })
}

describe('a diff whose changed rows all fit under the cap, with unchanged lines after them', () => {
  it('does not say truncated for a 3,000-line file with its first 1,250 lines replaced', () => {
    const { original, modified, result } = replacedAtTheTop(1_250, 1_750)

    expect(changedRows(result.lines)).toBe(MAX_MOBILE_DIFF_LINES)
    expectDrawnWhole(result, original, modified)
    expect(result.lines.map(shape).slice(-5)).toEqual([
      '+1250 new-1250',
      ' 1251 line-1251',
      ' 1252 line-1252',
      ' 1253 line-1253',
      '[1,747 unchanged lines]'
    ])
    expect(buildMobileDiffHunks(result.lines)).toEqual([
      expect.objectContaining({ addedLines: 1_250, deletedLines: 1_250 })
    ])
  })

  it('does not say truncated when a change after a folded start ends on the 2,500th row', () => {
    // 4 rows for the folded start, then 1,248 deleted and 1,248 added: 2,500 counted rows.
    const original = numbered(6_000, 'line')
    const modified = original.map((line, index) =>
      index >= 2_000 && index < 3_248 ? `new-${index + 1}` : line
    )
    const result = buildMobileDiffLines(file(original), file(modified))
    const rows = result.lines.map(shape)

    expectDrawnWhole(result, original, modified)
    expect(changedRows(result.lines)).toBe(2_496)
    expect(rows.slice(0, 5)).toEqual([
      '[1,997 unchanged lines]',
      ' 1998 line-1998',
      ' 1999 line-1999',
      ' 2000 line-2000',
      '-2001 line-2001'
    ])
    expect(rows.slice(-5)).toEqual([
      '+3248 new-3248',
      ' 3249 line-3249',
      ' 3250 line-3250',
      ' 3251 line-3251',
      '[2,749 unchanged lines]'
    ])
  })

  it('does not say truncated when the cap falls inside the unchanged rows after the last change', () => {
    // 2,498 changed rows: the cap used to take two of the three rows after them and refuse the rest.
    const { original, modified, result } = replacedAtTheTop(1_249, 1_751)

    expectDrawnWhole(result, original, modified)
    expect(result.lines.map(shape).slice(-4)).toEqual([
      ' 1250 line-1250',
      ' 1251 line-1251',
      ' 1252 line-1252',
      '[1,748 unchanged lines]'
    ])
  })

  it('draws the one unchanged line after 2,500 changed rows, and does not say truncated', () => {
    const { original, modified, result } = replacedAtTheTop(1_250, 1)

    expectDrawnWhole(result, original, modified)
    expect(result.lines.map(shape).slice(-2)).toEqual(['+1250 new-1250', ' 1251 line-1251'])
  })

  it('does not say truncated when a lone changed row is the 2,500th row and unchanged lines follow', () => {
    // 2,495 deleted rows, 4 unchanged rows too few to fold, then one added line: row 2,500.
    const between = numbered(4, 'between')
    const after = numbered(1_000, 'after')
    const original = [...numbered(2_495, 'old'), ...between, ...after]
    const modified = [...between, 'ADDED', ...after]
    const result = buildMobileDiffLines(file(original), file(modified))
    const rows = result.lines.map(shape)

    expectDrawnWhole(result, original, modified)
    expect(rows.slice(2_494)).toEqual([
      '-2495 old-2495',
      ' 1 between-1',
      ' 2 between-2',
      ' 3 between-3',
      ' 4 between-4',
      '+5 ADDED',
      ' 6 after-1',
      ' 7 after-2',
      ' 8 after-3',
      '[997 unchanged lines]'
    ])
  })
})

describe('a diff the cap does cut, with unchanged lines after the cut', () => {
  it('still says truncated, one added line left out, when the one row refused is a changed row', () => {
    const kept = numbered(1_749, 'line', 1_252)
    const original = [...numbered(1_251, 'old'), ...kept]
    const modified = [...numbered(1_250, 'new'), ...kept]
    const result = buildMobileDiffLines(file(original), file(modified))
    const rows = result.lines.map(shape)

    expect(result.truncated).toBe(true)
    expect(changedRows(result.lines)).toBe(MAX_MOBILE_DIFF_LINES)
    // The unchanged lines after a cut change are not drawn: the cut row ends the preview.
    expect(rows.slice(-2)).toEqual(['+1249 new-1249', '[... 1 added line not shown on mobile ...]'])
    expect(result.lines[result.lines.length - 1]?.note).toEqual({
      kind: 'truncated',
      hiddenAdded: 1,
      hiddenDeleted: 0
    })
    expect(describeMobileDiffTruncation(result.lines)).toBe(
      'Diff truncated for mobile preview: 1 added line not shown.'
    )
  })

  it('still says truncated when the cap falls between two changes and the later one is left out', () => {
    // Two changes cannot both reach the cap through buildMobileDiffLines (past 1,000 edits the
    // aligner rewrites the span between them as one block), so the runs are given directly.
    const oldLines = [
      ...numbered(1_250, 'old'),
      ...numbered(100, 'mid'),
      'OLD',
      ...numbered(100, 'end')
    ]
    const newLines = [
      ...numbered(1_250, 'new'),
      ...numbered(100, 'mid'),
      'NEW',
      ...numbered(100, 'end')
    ]
    const result = emitMobileDiffRows(
      [
        { kind: 'delete', oldStart: 0, length: 1_250 },
        { kind: 'add', newStart: 0, length: 1_250 },
        { kind: 'context', oldStart: 1_250, newStart: 1_250, length: 100 },
        { kind: 'delete', oldStart: 1_350, length: 1 },
        { kind: 'add', newStart: 1_350, length: 1 },
        { kind: 'context', oldStart: 1_351, newStart: 1_351, length: 100 }
      ],
      oldLines,
      newLines
    )
    const rows = result.lines.map(shape)

    expect(result.truncated).toBe(true)
    expect(rows.slice(-2)).toEqual([
      '+1250 new-1250',
      '[... 1 deleted and 1 added lines not shown on mobile ...]'
    ])
    expect(result.lines[result.lines.length - 1]?.note).toEqual({
      kind: 'truncated',
      hiddenAdded: 1,
      hiddenDeleted: 1
    })
  })
})
