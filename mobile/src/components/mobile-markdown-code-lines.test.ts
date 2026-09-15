import { describe, expect, it } from 'vitest'
import {
  MAX_MARKDOWN_CODE_LINES,
  mobileMarkdownCodeLines
} from './mobile-markdown-code-lines'

function text(lines: ReturnType<typeof mobileMarkdownCodeLines>['lines']): string[] {
  return lines.map((segments) => segments.map((segment) => segment.text).join(''))
}

// Asked for 2026-09-15: "in VS Code and all we have this code block with a line
// shown right, I need it like that".
describe('a fenced block as numbered lines', () => {
  it('gives one entry per line of the fence', () => {
    const block = mobileMarkdownCodeLines('const a = 1\nconst b = 2\nconst c = 3', 'ts')
    expect(text(block.lines)).toEqual(['const a = 1', 'const b = 2', 'const c = 3'])
  })

  it('colours a language the highlighter knows', () => {
    const block = mobileMarkdownCodeLines('const a = 1', 'ts')
    expect(block.language).not.toBe('plaintext')
    expect(block.lines[0]!.some((segment) => segment.kind !== 'plain')).toBe(true)
  })

  it('still numbers a fence whose language nothing highlights', () => {
    // The gutter is what makes a block readable; refusing to number it because
    // no grammar matched would be the wrong trade.
    const block = mobileMarkdownCodeLines('one\ntwo', 'no-such-language')
    expect(text(block.lines)).toEqual(['one', 'two'])
  })

  it('numbers a fence with no info string at all', () => {
    expect(text(mobileMarkdownCodeLines('plain one\nplain two', undefined).lines)).toEqual([
      'plain one',
      'plain two'
    ])
  })

  it('does not invent a trailing empty line from the fence’s own newline', () => {
    expect(text(mobileMarkdownCodeLines('only\n', 'sh').lines)).toEqual(['only'])
  })

  it('keeps a blank line the author wrote inside the block', () => {
    expect(text(mobileMarkdownCodeLines('a\n\nb', 'sh').lines)).toEqual(['a', '', 'b'])
  })

  it('counts the lines it does not draw instead of mounting thousands', () => {
    const huge = Array.from({ length: MAX_MARKDOWN_CODE_LINES + 25 }, (_, i) => `line ${i}`)
    const block = mobileMarkdownCodeLines(huge.join('\n'), 'sh')
    expect(block.lines).toHaveLength(MAX_MARKDOWN_CODE_LINES)
    expect(block.hidden).toBe(25)
  })

  it('reads an empty fence without a line to show', () => {
    const block = mobileMarkdownCodeLines('', 'sh')
    expect(block.hidden).toBe(0)
    expect(text(block.lines).join('')).toBe('')
  })

  it('reads a one-line fence', () => {
    const block = mobileMarkdownCodeLines('cd mobile && npx vitest run', 'sh')
    expect(text(block.lines)).toEqual(['cd mobile && npx vitest run'])
    expect(block.hidden).toBe(0)
  })
})
