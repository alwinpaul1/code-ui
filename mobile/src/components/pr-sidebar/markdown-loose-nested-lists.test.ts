import { describe, expect, it } from 'vitest'
import { parseMarkdownBlocks } from './markdown-blocks'

// Review, 2026-09-30: a nested list written after a blank line, a loose sublist, which review bots
// write all the time, left its item in a PR comment. '- a\n\n  - b' drew b as a list of its own at
// the margin, and '3. a\n\n   - x\n4. b' cut the numbered list into three blocks. The drawing is
// pinned in CommentMarkdown.lists.test.tsx.

const bullet = (depth: number) => ({ depth, ordered: false })
const numbered = (depth: number, number: number) => ({ depth, ordered: true, number })

describe('a nested list after a blank line in a PR comment', () => {
  it('keeps a nested bullet under its item instead of drawing a list of its own', () => {
    expect(parseMarkdownBlocks('- a\n\n  - b')).toEqual([
      { kind: 'list', ordered: false, items: ['a', 'b'], shapes: [bullet(0), bullet(1)] }
    ])
  })

  it('keeps a nested item’s loose sibling in the tree', () => {
    expect(parseMarkdownBlocks('- a\n  - b\n\n  - c')).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: ['a', 'b', 'c'],
        shapes: [bullet(0), bullet(1), bullet(1)]
      }
    ])
  })

  it('keeps a numbered list whole around it, still counting', () => {
    expect(parseMarkdownBlocks('3. a\n\n   - x\n4. b')).toEqual([
      {
        kind: 'list',
        ordered: true,
        items: ['a', 'x', 'b'],
        shapes: [numbered(0, 3), bullet(1), numbered(0, 4)]
      }
    ])
  })

  it('looks past more than one blank line, and none is left over at the end', () => {
    expect(parseMarkdownBlocks('- a\n\n\n  - b\n\n')).toEqual([
      { kind: 'list', ordered: false, items: ['a', 'b'], shapes: [bullet(0), bullet(1)] }
    ])
  })

  it('nests two levels in', () => {
    expect(parseMarkdownBlocks('- a\n  - b\n\n    - c')[0]).toMatchObject({
      items: ['a', 'b', 'c'],
      shapes: [bullet(0), bullet(1), bullet(2)]
    })
  })

  it('ends the list at a paragraph after it, as before', () => {
    expect(parseMarkdownBlocks('- a\n\n  - b\n\nc')).toEqual([
      { kind: 'list', ordered: false, items: ['a', 'b'], shapes: [bullet(0), bullet(1)] },
      { kind: 'paragraph', text: 'c' }
    ])
  })

  it('leaves a marker left of the item’s words after a blank line a list of its own, as before', () => {
    expect(parseMarkdownBlocks('- a\n\n - b')).toEqual([
      { kind: 'list', ordered: false, items: ['a'] },
      { kind: 'list', ordered: false, items: ['b'] }
    ])
    expect(parseMarkdownBlocks('1. a\n\n   - b\n\n2. c')).toEqual([
      { kind: 'list', ordered: true, items: ['a', 'b'], shapes: [numbered(0, 1), bullet(1)] },
      { kind: 'list', ordered: true, items: ['c'], start: 2 }
    ])
  })
})
