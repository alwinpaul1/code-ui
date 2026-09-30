// A diff at the mobile row cap whose file has no final newline.
//
// emitMobileDiffRows decides to fold from the file's rows alone (at most 2,500 here), then pushed
// git's "\ No newline at end of file" row through the same 2,500-row cap. A diff that fits was cut:
// 1,250 lines replaced by 1,250 others, the old side with no final newline, lost its last added
// row, said "Diff truncated for mobile preview: 1 added line not shown." and came back truncated
// (review, 2026-09-30). With the note after the last row, the note itself was the row the cap
// refused: truncated, with nothing left out. The note now rides with the changed row above it and
// is not counted, so a diff whose rows fit is drawn whole, notes included.

import { describe, expect, it } from 'vitest'
import { buildMobileDiffHunks } from './mobile-diff-hunks'
import { buildMobileDiffLines, type MobileDiffLine } from './mobile-diff-lines'
import { describeMobileDiffTruncation } from './mobile-diff-notes'
import { emitMobileDiffRows } from './mobile-diff-rows'

const NO_NEWLINE = '\\ No newline at end of file'

function numbered(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`)
}

/** The file's text, with or without its final newline. */
function file(lines: string[], terminated: boolean): string {
  return terminated ? `${lines.join('\n')}\n` : lines.join('\n')
}

/** A row as `+12 text`, `-12 text`, ` 12 text` or `[note text]`. */
function shape(line: MobileDiffLine): string {
  if (line.note) {
    return `[${line.text}]`
  }
  const sign = line.kind === 'add' ? '+' : line.kind === 'delete' ? '-' : ' '
  return `${sign}${line.newLineNumber ?? line.oldLineNumber} ${line.text}`
}

type Ends = 'both terminated' | 'old unterminated' | 'new unterminated' | 'both unterminated'
const ENDS: Ends[] = ['both terminated', 'old unterminated', 'new unterminated', 'both unterminated']

/** `changed` changed rows: every old line replaced, the old side one longer when the count is odd. */
function replaced(changed: number, ends: Ends) {
  const oldCount = Math.ceil(changed / 2)
  const newCount = changed - oldCount
  const oldUnterminated = ends === 'old unterminated' || ends === 'both unterminated'
  const newUnterminated = ends === 'new unterminated' || ends === 'both unterminated'
  return {
    oldCount,
    newCount,
    oldUnterminated,
    newUnterminated,
    result: buildMobileDiffLines(
      file(numbered(oldCount, 'old'), !oldUnterminated),
      file(numbered(newCount, 'new'), !newUnterminated)
    )
  }
}

describe.each(ENDS)('a replaced block at the 2,500-row cap, %s', (ends) => {
  it.each([
    ['2,499', 2_499],
    ['2,500', 2_500]
  ])('draws all %s changed rows whole, with the no-newline rows', (_label, changed) => {
    const { oldCount, newCount, oldUnterminated, newUnterminated, result } = replaced(changed, ends)
    const rows = result.lines.map(shape)

    expect(result.truncated).toBe(false)
    expect(result.lines.filter((line) => !line.note)).toHaveLength(changed)
    expect(result.lines.some((line) => line.note?.kind === 'truncated')).toBe(false)
    // Each note right after the last row of the side that lacks it, and nowhere else.
    expect(rows.slice(oldCount - 1, oldCount + 1)).toEqual([
      `-${oldCount} old-${oldCount}`,
      oldUnterminated ? `[${NO_NEWLINE}]` : '+1 new-1'
    ])
    expect(rows.slice(-2)).toEqual(
      newUnterminated
        ? [`+${newCount} new-${newCount}`, `[${NO_NEWLINE}]`]
        : [expect.any(String), `+${newCount} new-${newCount}`]
    )
    expect(rows.filter((row) => row === `[${NO_NEWLINE}]`)).toHaveLength(
      Number(oldUnterminated) + Number(newUnterminated)
    )
    expect(buildMobileDiffHunks(result.lines)).toEqual([
      expect.objectContaining({ addedLines: newCount, deletedLines: oldCount })
    ])
  })

  it('cuts 2,501 changed rows at 2,500 and says the one added row it left out', () => {
    const { oldCount, oldUnterminated, result } = replaced(2_501, ends)
    const rows = result.lines.map(shape)

    expect(result.truncated).toBe(true)
    expect(result.lines.filter((line) => !line.note)).toHaveLength(2_500)
    expect(result.lines[result.lines.length - 1]?.note).toEqual({
      kind: 'truncated',
      hiddenAdded: 1,
      hiddenDeleted: 0
    })
    expect(describeMobileDiffTruncation(result.lines)).toBe(
      'Diff truncated for mobile preview: 1 added line not shown.'
    )
    // The old side's note stays with its drawn row; the new side's last row, and so its note, is
    // the one left out.
    expect(rows[oldCount]).toBe(oldUnterminated ? `[${NO_NEWLINE}]` : '+1 new-1')
    expect(rows.filter((row) => row === `[${NO_NEWLINE}]`)).toHaveLength(Number(oldUnterminated))
    expect(rows[rows.length - 2]).toBe('+1249 new-1249')
  })
})

describe('the no-newline rows at the smallest sizes', () => {
  it('draws a one-line file changed with no final newline on either side, both notes', () => {
    const result = buildMobileDiffLines('a', 'b')
    expect(result.truncated).toBe(false)
    expect(result.lines.map(shape)).toEqual([
      '-1 a',
      `[${NO_NEWLINE}]`,
      '+1 b',
      `[${NO_NEWLINE}]`
    ])
  })

  it('draws an empty diff as nothing, untruncated', () => {
    expect(buildMobileDiffLines('', '')).toEqual({ lines: [], truncated: false })
    expect(emitMobileDiffRows([], [], [], { oldUnterminated: true, newUnterminated: true })).toEqual({
      lines: [],
      truncated: false
    })
  })

  it('keeps the notes beside a folded change on the last line of a 3,000-line file', () => {
    const original = numbered(3_000, 'line')
    const modified = [...original.slice(0, -1), 'CHANGED-3000']
    const result = buildMobileDiffLines(file(original, false), file(modified, false))

    expect(result.truncated).toBe(false)
    expect(result.lines.map(shape)).toEqual([
      '[2,996 unchanged lines]',
      ' 2997 line-2997',
      ' 2998 line-2998',
      ' 2999 line-2999',
      '-3000 line-3000',
      `[${NO_NEWLINE}]`,
      '+3000 CHANGED-3000',
      `[${NO_NEWLINE}]`
    ])
  })
})
