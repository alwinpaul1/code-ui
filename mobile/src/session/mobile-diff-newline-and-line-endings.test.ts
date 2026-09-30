// An edit that only adds or removes the final newline, or only converts line endings, in the
// mobile diff preview.
//
// The content was split with the trailing newline dropped and on /\r?\n/, so 'a\nb' against
// 'a\nb\n', and 'a\r\nb\r\n' against 'a\nb\n', came out as nothing but context rows: a file source
// control lists as modified opened on a diff that claims nothing changed (reproduced on main
// 0b2c7a92). A final-newline change now shows the last line as changed with git's
// "\ No newline at end of file" row, and an endings-only change says so. A content edit in a CRLF
// file still diffs by content, not by its CRs.

import { describe, expect, it } from 'vitest'
import { buildMobileDiffHunks } from './mobile-diff-hunks'
import { buildMobileDiffLines, type MobileDiffLine } from './mobile-diff-lines'

/** A row as `+2 b`, `-2 b`, ` 1 a` or `[note text]`. */
function shape(line: MobileDiffLine): string {
  if (line.note) {
    return `[${line.text}]`
  }
  const sign = line.kind === 'add' ? '+' : line.kind === 'delete' ? '-' : ' '
  return `${sign}${line.newLineNumber ?? line.oldLineNumber} ${line.text}`
}

function rows(original: string, modified: string): string[] {
  return buildMobileDiffLines(original, modified).lines.map(shape)
}

describe('a final newline added or removed', () => {
  it('shows the last line as changed when the final newline is added', () => {
    expect(rows('a\nb', 'a\nb\n')).toEqual([
      ' 1 a',
      '-2 b',
      '[\\ No newline at end of file]',
      '+2 b'
    ])
  })

  it('shows the last line as changed when the final newline is removed', () => {
    expect(rows('a\nb\n', 'a\nb')).toEqual([
      ' 1 a',
      '-2 b',
      '+2 b',
      '[\\ No newline at end of file]'
    ])
  })

  it('keeps the change one hunk, the no-newline row inside it', () => {
    const result = buildMobileDiffLines('a\nb', 'a\nb\n')
    expect(buildMobileDiffHunks(result.lines)).toEqual([
      expect.objectContaining({ startIndex: 1, endIndex: 3, addedLines: 1, deletedLines: 1 })
    ])
  })

  it('shows a one-line file gaining its newline', () => {
    expect(rows('a', 'a\n')).toEqual(['-1 a', '[\\ No newline at end of file]', '+1 a'])
  })

  it('marks the side that lacks it when the last line also changed', () => {
    expect(rows('a\nb', 'a\nc\n')).toEqual([
      ' 1 a',
      '-2 b',
      '[\\ No newline at end of file]',
      '+2 c'
    ])
  })

  it('says nothing about newlines when neither side ends in one and the last line is untouched', () => {
    expect(rows('x\nb', 'y\nb')).toEqual(['-1 x', '+1 y', ' 2 b'])
  })

  it('draws two empty files as nothing, and an empty file gaining one newline as one empty line', () => {
    expect(rows('', '')).toEqual([])
    expect(rows('', '\n')).toEqual(['+1 '])
    expect(rows('\n', '')).toEqual(['-1 '])
  })
})

describe('line endings converted', () => {
  it('says only the line endings changed, CRLF to LF', () => {
    const result = buildMobileDiffLines('a\r\nb\r\n', 'a\nb\n')
    expect(result.lines.map(shape)).toEqual([
      '[Only line endings changed (CRLF → LF)]',
      ' 1 a',
      ' 2 b'
    ])
    expect(result.lines[0]?.note).toEqual({
      kind: 'line-endings',
      from: 'crlf',
      to: 'lf',
      only: true
    })
  })

  it('says only the line endings changed, LF to CRLF, in a one-line file', () => {
    expect(rows('a\n', 'a\r\n')).toEqual(['[Only line endings changed (LF → CRLF)]', ' 1 a'])
  })

  it('says so when the endings moved between lines but the mix is the same', () => {
    expect(rows('a\r\nb\n', 'a\nb\r\n')).toEqual(['[Only line endings changed]', ' 1 a', ' 2 b'])
  })

  it('diffs a content edit in a CRLF file by content, not by its CRs', () => {
    expect(rows('a\r\nb\r\nc\r\n', 'a\r\nB\r\nc\r\n')).toEqual([' 1 a', '-2 b', '+2 B', ' 3 c'])
  })

  it('shows the content edit and says the endings changed too', () => {
    expect(rows('a\r\nb\r\n', 'a\nB\n')).toEqual([
      '[Line endings changed too (CRLF → LF)]',
      ' 1 a',
      '-2 b',
      '+2 B'
    ])
  })

  it('leaves an unchanged file with no rows but its own', () => {
    expect(rows('a\r\nb\r\n', 'a\r\nb\r\n')).toEqual([' 1 a', ' 2 b'])
  })
})
