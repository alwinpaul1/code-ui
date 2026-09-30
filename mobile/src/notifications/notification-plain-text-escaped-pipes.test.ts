import { describe, expect, it } from 'vitest'
import { notificationPlainText, styleText } from './notification-plain-text'

const mono = (text: string) => styleText(text, 'mono')
const table = (...rows: string[]) => ['| Check | Result |', '|---|---|', ...rows].join('\n')

// GFM lets a cell hold a pipe written `\|`, inside a code span too (spec example 200: `\|` in
// backticks is a code span holding `|`), and the chat reads a table with marked, which splits a
// row only on a pipe with an even run of backslashes before it. The shade split on every pipe, so
// `| a \| b | ok |` read "a · b · ok", three cells under a two-column header, and the pipe the
// author escaped was gone (review, 2026-09-30).
describe('a table cell with an escaped pipe in the shade', () => {
  it('keeps the cell whole and draws the pipe', () => {
    expect(notificationPlainText(table('| a \\| b | ok |'))).toBe('Check · Result\na | b · ok')
  })

  it('draws an escaped pipe inside a code span as a pipe in the code', () => {
    expect(notificationPlainText(table('| `a \\| b` | ok |'))).toBe(`Check · Result\n${mono('a | b')} · ok`)
    expect(notificationPlainText(table('| `\\|` | ok |'))).toBe(`Check · Result\n${mono('|')} · ok`)
  })

  it('keeps an escaped pipe in the header row, and in a row cut from its table', () => {
    expect(notificationPlainText('| a \\| b | c |\n|---|---|\n| 1 | 2 |')).toBe('a | b · c\n1 · 2')
    expect(notificationPlainText('| a \\| b | ok |')).toBe('a | b · ok')
  })

  it('keeps a row whose last pipe is escaped, with the pipe in its last cell', () => {
    expect(notificationPlainText(table('| a | b\\|'))).toBe('Check · Result\na · b|')
  })

  it('reads a row that is only an escaped pipe as that pipe', () => {
    expect(notificationPlainText('| \\| |')).toBe('|')
  })

  it('reads a line whose closing pipe is escaped as prose, not as a row cut from a table', () => {
    // No closing boundary, so nothing fences it on its own; prose drops the backslash.
    expect(notificationPlainText('| a \\|')).toBe('| a |')
  })

  it('splits at a pipe after two backslashes, and keeps one after three', () => {
    // Two: an escaped backslash, then a real pipe. Three: an escaped backslash and an escaped pipe.
    expect(notificationPlainText(table('| a | b \\\\|'))).toBe('Check · Result\na · b \\')
    expect(notificationPlainText(table('| a \\\\\\| b | ok |'))).toBe('Check · Result\na \\| b · ok')
  })

  it('keeps a trailing backslash in a cell, which escapes only the space after it', () => {
    expect(notificationPlainText(table('| C:\\ | root |'))).toBe('Check · Result\nC:\\ · root')
  })

  it('keeps the cell whole in a table the desktop squashed onto one line', () => {
    expect(notificationPlainText('| Check | Result | |---|---| | a \\| b | ok | | c | d |')).toBe(
      'Check · Result\na | b · ok\nc · d'
    )
  })

  it('still splits a cell at an unescaped pipe inside a code span, as GFM and marked do', () => {
    // A code span does not protect a pipe in a table row: `ls | wc` is two cells there, and the
    // chat splits it too. Not a bug to fix: reading it as one cell would disagree with the chat.
    const row = notificationPlainText(table('| `ls | wc` | ok |')).split('\n')[1]!
    expect(row.split(' \u00b7 ')).toHaveLength(3)
  })

  it('leaves an escaped pipe in prose as prose reads it, with a code span keeping its backslash', () => {
    expect(notificationPlainText('run a \\| b to pipe it')).toBe('run a | b to pipe it')
    expect(notificationPlainText('use `a\\|b` here')).toBe(`use ${mono('a\\|b')} here`)
  })
})
