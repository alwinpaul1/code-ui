// @vitest-environment happy-dom
import { marked, type Tokens } from 'marked'
import { describe, expect, it } from 'vitest'
import { editedSurface, savedUntouched } from './rich-markdown-round-trip.test-support'

// Review, 2026-09-30: a list nested under an ordered item was saved two columns in, whatever the
// width of the item's marker. '1. a\n   - b\n2. c' saved as '1. a\n  - b\n2. c', and to CommonMark,
// GitHub and the desktop a child of `1. ` needs three columns: `b` became a list of its own that
// split the ordered list in two. A child is now written where its source put it, and a list the
// source never had (the engine's) at its parent's marker width: `1. ` is 3, `10. ` is 4, `- ` is 2.

/** Whether a CommonMark reader's list item holds a list of its own. */
function holdsList(item: Tokens.ListItem): boolean {
  return item.tokens.some((inner) => inner.type === 'list')
}

/** What a CommonMark reader (marked, as the desktop and the chat use) makes of the top level. */
function topLevel(markdown: string): string[] {
  return marked
    .lexer(markdown)
    .filter((token) => token.type !== 'space')
    .map((token) => {
      if (token.type !== 'list') {
        return token.type
      }
      const { items } = token as Tokens.List
      return `list of ${items.length}, nested: ${items.some(holdsList)}`
    })
}

describe('a list nested under an item, from markdown and back', () => {
  it.each([
    ['bullets under an ordered item', '1. a\n   - b\n2. c'],
    ['bullets under an item numbered past 9', '9. a\n10. b\n    - c\n11. d'],
    ['bullets under a bullet', '- a\n  - b\n- c'],
    ['an ordered list under an ordered list under an ordered list', '1. a\n   1. b\n      1. c'],
    ['four columns under `1. `, as some authors indent', '1. a\n    - b\n2. c'],
    ['siblings indented differently', '- a\n    - b\n  - c'],
    ['a task under an ordered item', '1. a\n   - [x] done']
  ])('saves %s back as written', (_name, markdown) => {
    expect(savedUntouched(markdown)).toBe(markdown)
  })

  it('keeps an ordered list one list for a CommonMark reader once saved', () => {
    const saved = savedUntouched('1. a\n   - b\n2. c')
    expect(topLevel(saved)).toEqual(['list of 2, nested: true'])
  })

  it.each([
    ['under `1. `', '<ol><li><p>a</p><ul><li><p>b</p></li></ul></li></ol>', '1. a\n   - b'],
    [
      'under `10. `',
      '<ol start="10"><li><p>a</p><ul><li><p>b</p></li></ul></li></ol>',
      '10. a\n    - b'
    ],
    ['under `- `', '<ul><li><p>a</p><ol><li><p>b</p></li></ol></li></ul>', '- a\n  1. b'],
    [
      'under a task',
      '<ul data-type="taskList"><li data-checked="false"><label contenteditable="false"><input type="checkbox"></label><div><p>a</p><ul><li><p>b</p></li></ul></div></li></ul>',
      '- [ ] a\n  - b'
    ]
  ])('writes a list the engine nested %s at the marker width', (_name, markup, markdown) => {
    const saved = editedSurface(markup).saved()
    expect(saved).toBe(markdown)
    expect(topLevel(saved)).toEqual(['list of 1, nested: true'])
  })

  it('writes the default width for an item whose remembered indent is no indent at all', () => {
    const markup = '<ol><li><p>a</p><ul><li data-md-indent="0"><p>b</p></li></ul></li></ol>'
    expect(editedSurface(markup).saved()).toBe('1. a\n   - b')
  })
})
