// A change deep in a long file, in the mobile diff preview (diff review and the branch-diff
// drawer both build their rows with buildMobileDiffLines).
//
// A 3,000-line file with line 2,900 changed is over MAX_DIFF_CELLS, and the prefix/suffix
// fallback emitted all 2,899 shared rows as context, then stopped at the 2,500-row cap before it
// reached the change: 2,501 rows, zero hunks, only context, and "Diff truncated for mobile preview."
// at the end (reproduced on main 0b2c7a92). A reviewer could mark the file reviewed with nothing to
// review. Long unchanged runs now collapse to three rows around each change and a visible
// "N unchanged lines" row, truncation never cuts before the first change, and the truncation row
// says what it left out. Line numbers stay the file's own, which is what review notes anchor on.

import { describe, expect, it } from 'vitest'
import { buildMobileDiffHunks } from './mobile-diff-hunks'
import { buildMobileDiffLines, type MobileDiffLine } from './mobile-diff-lines'

function numbered(count: number, prefix = 'line'): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`)
}

function file(lines: string[]): string {
  return `${lines.join('\n')}\n`
}

function changed(lines: string[], ...lineNumbers: number[]): string[] {
  const next = [...lines]
  for (const lineNumber of lineNumbers) {
    next[lineNumber - 1] = `CHANGED-${lineNumber}`
  }
  return next
}

/** A row as `+12 text`, `-12 text`, ` 12 text` or `[note text]`. */
function shape(line: MobileDiffLine): string {
  if (line.note) {
    return `[${line.text}]`
  }
  const sign = line.kind === 'add' ? '+' : line.kind === 'delete' ? '-' : ' '
  return `${sign}${line.newLineNumber ?? line.oldLineNumber} ${line.text}`
}

describe('a change deep in a long file', () => {
  it('shows a change on line 2,900 of a 3,000-line file, with a hunk to jump to', () => {
    const original = numbered(3_000)
    const result = buildMobileDiffLines(file(original), file(changed(original, 2_900)))

    expect(buildMobileDiffHunks(result.lines)).toHaveLength(1)
    expect(result.truncated).toBe(false)
    expect(result.lines.map(shape)).toEqual([
      '[2,896 unchanged lines]',
      ' 2897 line-2897',
      ' 2898 line-2898',
      ' 2899 line-2899',
      '-2900 line-2900',
      '+2900 CHANGED-2900',
      ' 2901 line-2901',
      ' 2902 line-2902',
      ' 2903 line-2903',
      '[97 unchanged lines]'
    ])
  })

  it('keeps each row on the line numbers review notes anchor on', () => {
    const original = numbered(3_000)
    const modified = changed(original, 2_900)
    modified.splice(1_500, 0, 'INSERTED')
    const result = buildMobileDiffLines(file(original), file(modified))

    for (const line of result.lines) {
      if (line.note) {
        expect(line.oldLineNumber).toBeUndefined()
        expect(line.newLineNumber).toBeUndefined()
        continue
      }
      if (line.oldLineNumber !== undefined) {
        expect(line.text).toBe(original[line.oldLineNumber - 1])
      }
      if (line.newLineNumber !== undefined) {
        expect(line.text).toBe(modified[line.newLineNumber - 1])
      }
    }
    expect(buildMobileDiffHunks(result.lines)).toHaveLength(2)
  })

  it('shows a change on the first line', () => {
    const original = numbered(3_000)
    const result = buildMobileDiffLines(file(original), file(changed(original, 1)))

    expect(result.lines.map(shape)).toEqual([
      '-1 line-1',
      '+1 CHANGED-1',
      ' 2 line-2',
      ' 3 line-3',
      ' 4 line-4',
      '[2,996 unchanged lines]'
    ])
  })

  it('shows a change on the last line', () => {
    const original = numbered(3_000)
    const result = buildMobileDiffLines(file(original), file(changed(original, 3_000)))

    expect(result.lines.map(shape)).toEqual([
      '[2,996 unchanged lines]',
      ' 2997 line-2997',
      ' 2998 line-2998',
      ' 2999 line-2999',
      '-3000 line-3000',
      '+3000 CHANGED-3000'
    ])
  })

  it('shows both changes, as two hunks, when they sit more than 2,500 rows apart', () => {
    const original = numbered(6_000)
    const result = buildMobileDiffLines(file(original), file(changed(original, 10, 5_000)))

    expect(result.truncated).toBe(false)
    expect(buildMobileDiffHunks(result.lines)).toHaveLength(2)
    expect(result.lines.map(shape)).toEqual([
      '[6 unchanged lines]',
      ' 7 line-7',
      ' 8 line-8',
      ' 9 line-9',
      '-10 line-10',
      '+10 CHANGED-10',
      ' 11 line-11',
      ' 12 line-12',
      ' 13 line-13',
      '[4,983 unchanged lines]',
      ' 4997 line-4997',
      ' 4998 line-4998',
      ' 4999 line-4999',
      '-5000 line-5000',
      '+5000 CHANGED-5000',
      ' 5001 line-5001',
      ' 5002 line-5002',
      ' 5003 line-5003',
      '[997 unchanged lines]'
    ])
  })

  it('still shows the change when a one-line file becomes a 150,000-line one', () => {
    const modified = ['keep', ...numbered(149_999, 'new')]
    const result = buildMobileDiffLines('keep\n', file(modified))

    expect(result.lines[0]).toEqual({
      kind: 'context',
      text: 'keep',
      oldLineNumber: 1,
      newLineNumber: 1
    })
    expect(result.lines[1]).toEqual({ kind: 'add', text: 'new-1', newLineNumber: 2 })
    expect(buildMobileDiffHunks(result.lines).length).toBeGreaterThan(0)
    expect(result.truncated).toBe(true)
    const last = result.lines[result.lines.length - 1]
    expect(last?.note).toEqual({ kind: 'truncated', hiddenAdded: 147_500, hiddenDeleted: 0 })
    expect(last?.text).toBe('... 147,500 added lines not shown on mobile ...')
  })

  it('draws a one-line file, changed and unchanged, with no collapsed row', () => {
    expect(buildMobileDiffLines('a\n', 'b\n').lines.map(shape)).toEqual(['-1 a', '+1 b'])
    expect(buildMobileDiffLines('a\n', 'a\n').lines.map(shape)).toEqual([' 1 a'])
  })

  it('leaves a diff that fits whole exactly as it was, every unchanged row included', () => {
    const original = numbered(1_200)
    const result = buildMobileDiffLines(file(original), file(changed(original, 600)))

    expect(result.lines).toHaveLength(1_201)
    expect(result.lines.some((line) => line.note)).toBe(false)
    expect(result.lines[599]).toEqual({ kind: 'delete', text: 'line-600', oldLineNumber: 600 })
    expect(result.lines[600]).toEqual({ kind: 'add', text: 'CHANGED-600', newLineNumber: 600 })
  })

  it('diffs two separate edits in a medium file line by line, not as one block', () => {
    // Over MAX_DIFF_CELLS (200,000) but under the row cap: the prefix/suffix fallback used to
    // draw every line between the two edits as deleted and re-added.
    const original = numbered(1_000)
    const result = buildMobileDiffLines(file(original), file(changed(original, 10, 900)))

    expect(result.lines.filter((line) => line.kind !== 'context').map(shape)).toEqual([
      '-10 line-10',
      '+10 CHANGED-10',
      '-900 line-900',
      '+900 CHANGED-900'
    ])
    expect(result.lines).toHaveLength(1_002)
  })
})
