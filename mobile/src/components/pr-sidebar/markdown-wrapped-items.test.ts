import { describe, expect, it } from 'vitest'
import { parseMarkdownBlocks } from './markdown-blocks'

// The same defect the chat parser had, in the second parser in this repo.
//
// A list item hard-wrapped at 80 columns ended the list at its first
// continuation line: that line became its own paragraph at the left margin, and
// the next item opened a FRESH list, so every item was numbered "1." (reported
// from the device on 2026-09-15 against the chat parser; the chat parser now
// uses marked). GitHub comment bodies — what this parser reads — are wrapped
// exactly this way, by every editor that soft-wraps and every agent that writes
// one.
describe('a PR comment whose list items are hard-wrapped', () => {
  it('keeps a wrapped item in its list instead of numbering every item 1', () => {
    const blocks = parseMarkdownBlocks(
      [
        '1. First step, written long enough that the author wrapped it',
        '   onto a second line.',
        '2. Second step.',
        '3. Third step.'
      ].join('\n')
    )
    expect(blocks).toEqual([
      {
        kind: 'list',
        ordered: true,
        items: [
          'First step, written long enough that the author wrapped it onto a second line.',
          'Second step.',
          'Third step.'
        ]
      }
    ])
  })

  it('reflows a wrapped bullet rather than leaving it a stray paragraph', () => {
    const blocks = parseMarkdownBlocks(
      ['- A bullet that runs on', '  past the wrap column.', '- The next bullet.'].join('\n')
    )
    expect(blocks).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: ['A bullet that runs on past the wrap column.', 'The next bullet.']
      }
    ])
  })

  it('ends the list at a blank line, as markdown says', () => {
    const blocks = parseMarkdownBlocks(
      ['- One', '', 'A paragraph that follows, not part of the item.'].join('\n')
    )
    expect(blocks).toEqual([
      { kind: 'list', ordered: false, items: ['One'] },
      { kind: 'paragraph', text: 'A paragraph that follows, not part of the item.' }
    ])
  })

  it('does not swallow an unindented line under an item', () => {
    const blocks = parseMarkdownBlocks(['- One', 'Flush against the margin.'].join('\n'))
    expect(blocks).toEqual([
      { kind: 'list', ordered: false, items: ['One'] },
      { kind: 'paragraph', text: 'Flush against the margin.' }
    ])
  })

  it('leaves a one-item list alone', () => {
    expect(parseMarkdownBlocks('- Only one')).toEqual([
      { kind: 'list', ordered: false, items: ['Only one'] }
    ])
  })
})
