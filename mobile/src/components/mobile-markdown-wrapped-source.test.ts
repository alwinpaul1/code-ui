import { describe, expect, it } from 'vitest'
import { parseMobileMarkdown } from './mobile-markdown-parser'

// The fixtures below are lifted verbatim out of this repository's own
// CLAUDE.md, which is hard-wrapped at 80 columns. That is the document the
// defects were reported against: on a ~40-column phone every source line wraps
// to two display lines, the old parser broke after each one, and constructs
// that crossed a wrap came apart.
const NUMBERED_LIST = [
  'So, for every reported bug:',
  '',
  '1. **Write the failing test first**, from the real symptom, in the same commit.',
  '   Run it and watch it fail. A test that passes before the fix is testing',
  '   something else.',
  '2. **Feed it the real screen, not a paraphrase.** Terminal parsers break on',
  '   the exact bytes an agent paints: the indent, the wrap column, the marker',
  '   glyph, the hint wording.',
  '3. **Name the test after the symptom**, not the function.'
].join('\n')

const BOLD_ACROSS_A_WRAP = [
  '**When a figure genuinely cannot be known, show what is known and say the rest',
  'is unknown.** Never invent a denominator.'
].join('\n')

describe('a document hard-wrapped at 80 columns', () => {
  it('numbers a wrapped list 1, 2, 3 instead of starting over at every item', () => {
    // Reported from the device: every item read "1.". The old line loop ended
    // the list at the first indented continuation line, so each item became a
    // fresh single-item list.
    const blocks = parseMobileMarkdown(NUMBERED_LIST)
    const lists = blocks.filter((block) => block.type === 'list')
    expect(lists).toHaveLength(1)
    const list = lists[0]!
    expect(list.type === 'list' && list.ordered).toBe(true)
    expect(list.type === 'list' && list.items.map((item) => item.number)).toEqual([1, 2, 3])
  })

  it('keeps a wrapped item’s continuation inside that item', () => {
    const blocks = parseMobileMarkdown(NUMBERED_LIST)
    const list = blocks.find((block) => block.type === 'list')
    expect(list?.type).toBe('list')
    const first = list?.type === 'list' ? list.items[0]!.text : ''
    expect(first).toContain('Run it and watch it fail')
    expect(first).toContain('something else.')
  })

  it('numbers from the list’s own start, so `3.` does not become `1.`', () => {
    const blocks = parseMobileMarkdown('3. third\n4. fourth')
    const list = blocks[0]
    expect(list?.type === 'list' && list.items.map((item) => item.number)).toEqual([3, 4])
  })

  it('fills a wrapped paragraph to the phone’s width instead of keeping the source wrap', () => {
    // The desktop hard-breaks every newline (remark-breaks, on both of its
    // surfaces). That reads correctly in a wide window and badly at 40
    // columns, where each source line wraps AND breaks.
    const blocks = parseMobileMarkdown('one two three\nfour five six\nseven')
    expect(blocks).toEqual([{ type: 'paragraph', text: 'one two three four five six seven' }])
  })

  it('keeps the two deliberate hard breaks a writer asks for', () => {
    expect(parseMobileMarkdown('first line  \nsecond line')).toEqual([
      { type: 'paragraph', text: 'first line\nsecond line' }
    ])
    expect(parseMobileMarkdown('first line\\\nsecond line')).toEqual([
      { type: 'paragraph', text: 'first line\nsecond line' }
    ])
  })

  it('resolves a bold span whose opener and closer sit on different source lines', () => {
    // Reported from the device: the asterisks rendered literally.
    const blocks = parseMobileMarkdown(BOLD_ACROSS_A_WRAP)
    expect(blocks).toHaveLength(1)
    const paragraph = blocks[0]!
    expect(paragraph.type).toBe('paragraph')
    expect(paragraph.type === 'paragraph' && paragraph.text).toContain(
      '**When a figure genuinely cannot be known, show what is known and say the rest is unknown.**'
    )
  })

  it('gives a nested list its own depth and marker instead of flattening it', () => {
    const blocks = parseMobileMarkdown('- outer\n  - inner\n    1. deepest\n- second outer')
    const list = blocks[0]
    expect(list?.type).toBe('list')
    const items = list?.type === 'list' ? list.items : []
    expect(items.map((item) => [item.text, item.depth, item.ordered])).toEqual([
      ['outer', 0, false],
      ['inner', 1, false],
      ['deepest', 2, true],
      ['second outer', 0, false]
    ])
  })

  it('keeps a task list’s boxes through the nesting', () => {
    const blocks = parseMobileMarkdown('- [x] done\n  - [ ] not yet')
    const items = blocks[0]?.type === 'list' ? blocks[0].items : []
    expect(items.map((item) => [item.text, item.checked, item.depth])).toEqual([
      ['done', true, 0],
      ['not yet', false, 1]
    ])
  })

  it('reads a setext heading the agents still write', () => {
    expect(parseMobileMarkdown('Title\n=====\n\nbody')).toEqual([
      { type: 'heading', level: 1, text: 'Title' },
      { type: 'paragraph', text: 'body' }
    ])
  })
})
