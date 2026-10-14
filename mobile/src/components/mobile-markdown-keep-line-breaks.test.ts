import { describe, expect, it } from 'vitest'
import { parseMobileMarkdown } from './mobile-markdown-parser'

// A sent prompt's lines are each meant: the person pressed Enter. A reply's
// soft newline is a space (the phone fills prose to its width), which for a
// prompt would fold "Fix this:\n`foo()`\nthen run tests" into one line.
// `keepLineBreaks` is the prompt's rule, the one a quote already has.
describe('keeping the line breaks a person typed', () => {
  const text = (blocks: ReturnType<typeof parseMobileMarkdown>, at = 0): string | undefined => {
    const block = blocks[at]
    return block && 'text' in block ? block.text : undefined
  }

  it('keeps a newline in a paragraph, where a reply folds it into a space', () => {
    expect(text(parseMobileMarkdown('one two\nthree'))).toBe('one two three')
    expect(text(parseMobileMarkdown('one two\nthree', true))).toBe('one two\nthree')
  })

  it('keeps the newlines of a longer run, and the blank line between paragraphs', () => {
    const blocks = parseMobileMarkdown('a\nb\nc\n\nd\ne', true)
    expect(blocks.map((block) => ('text' in block ? block.text : block.type))).toEqual(['a\nb\nc', 'd\ne'])
  })

  it('keeps a line a list item carries over, and a heading as it was', () => {
    const [list, heading] = parseMobileMarkdown('- first\n  second\n\n# Title', true)
    expect(list).toMatchObject({ type: 'list', items: [{ text: 'first\nsecond' }] })
    expect(heading).toMatchObject({ type: 'heading', text: 'Title' })
  })

  it('leaves a fence exactly as it was in both rules', () => {
    const source = '```bash\nuntil mkdir x\ntrap y\n```'
    const filled = parseMobileMarkdown(source)
    const kept = parseMobileMarkdown(source, true)
    expect(kept).toEqual(filled)
    expect(kept[0]).toMatchObject({ type: 'code', text: 'until mkdir x\ntrap y', language: 'bash' })
  })

  it('draws one line, no line, and a lone newline the same in both rules', () => {
    for (const source of ['one line', '', '\n', '\n\n']) {
      expect(parseMobileMarkdown(source, true)).toEqual(parseMobileMarkdown(source))
    }
  })

  it('still takes the two spelled hard breaks as breaks, without their marks', () => {
    expect(text(parseMobileMarkdown('a  \nb', true))).toBe('a\nb')
    expect(text(parseMobileMarkdown('a\\\nb', true))).toBe('a\nb')
  })

  it('keeps the two rules apart in the cache, whichever is read first', () => {
    const source = 'cache one\ncache two'
    const kept = parseMobileMarkdown(source, true)
    const filled = parseMobileMarkdown(source)
    expect(text(kept)).toBe('cache one\ncache two')
    expect(text(filled)).toBe('cache one cache two')
    expect(parseMobileMarkdown(source, true)).toBe(kept)
    expect(parseMobileMarkdown(source)).toBe(filled)
    const second = 'cache three\ncache four'
    const filledFirst = parseMobileMarkdown(second)
    expect(text(parseMobileMarkdown(second, true))).toBe('cache three\ncache four')
    expect(parseMobileMarkdown(second)).toBe(filledFirst)
  })
})
