// @vitest-environment happy-dom
import { marked } from 'marked'
import { describe, expect, it } from 'vitest'
import { openedSurface, savedUntouched } from './rich-markdown-round-trip.test-support'

/** marked's reading of a document, whitespace aside. */
const reading = (source: string) =>
  marked.parse(source, { async: false }).replace(/\s+/g, ' ').replace(/> </g, '><').trim()

// Review, 2026-09-30: a nested list written after a blank line, a loose sublist, which agents and
// READMEs write all the time, ended the list at the blank. '- a\n\n  - b' saved as '- a\n\n- b', so
// the nested bullet became a sibling at the margin, and under a numbered item it left the item and
// cut the numbering in two: '1. a\n\n   - b\n2. c' saved as '1. a\n\n- b\n\n2. c'.
describe('a nested list after a blank line', () => {
  it.each([
    ['under a bullet', '- a\n\n  - b'],
    ['under a numbered item, before the next', '1. a\n\n   - b\n2. c'],
    ['as a nested item’s loose sibling', '- a\n  - b\n\n  - c'],
    ['after a later paragraph of the item', '- a\n\n  more\n\n  - b'],
    ['two levels in', '- a\n  - b\n\n    - c'],
    ['numbered, under a bullet', '- a\n\n  1. b\n  2. c'],
    ['followed by a sibling after a blank line', '- a\n\n  - b\n\n- c'],
    ['followed by a paragraph at the margin', '- a\n\n  - b\n\nc'],
    ['followed by the item’s own paragraph', '- a\n\n  - b\n\n  more'],
    ['under a task', '- [ ] a\n\n  - [x] b']
  ])('keeps it nested %s', (_name, markdown) => {
    expect(savedUntouched(markdown)).toBe(markdown)
    expect(reading(savedUntouched(markdown))).toBe(reading(markdown))
  })

  it('draws the nested list inside its item, and the numbered list whole', () => {
    const { editor } = openedSurface('1. a\n\n   - b\n2. c')
    expect(editor.querySelectorAll(':scope > ol')).toHaveLength(1)
    expect(editor.querySelectorAll(':scope > ol > li')).toHaveLength(2)
    expect(editor.querySelector(':scope > ol > li > ul > li')?.textContent).toBe('b')
  })

  it('keeps it nested for a CommonMark reader once saved', () => {
    expect(reading(savedUntouched('- a\n\n  - b'))).toBe(
      '<ul><li><p>a</p><ul><li>b</li></ul></li></ul>'
    )
  })

  it('keeps the blank line when the nested item’s words are edited', () => {
    const { editor, saved } = openedSurface('- a\n\n  - b\n- c')
    editor.querySelector('ul ul > li > p')!.textContent = 'b, edited'
    expect(saved()).toBe('- a\n\n  - b, edited\n- c')
  })

  it('writes one blank line for several, and none for the blank lines at the end', () => {
    expect(savedUntouched('- a\n\n\n  - b\n\n')).toBe('- a\n\n  - b')
  })

  it('ends the list at a marker left of the item’s words, as it always did', () => {
    // One column in is not under `- `'s words: CommonMark reads a sibling, and so does the save.
    const markdown = '- a\n\n - b'
    expect(savedUntouched(markdown)).toBe('- a\n\n- b')
    expect(reading(savedUntouched(markdown))).toBe(reading(markdown))
  })

  it('keeps a lazy line under the nested item after the blank', () => {
    expect(savedUntouched('- a\n\n  - b\nlazy')).toBe('- a\n\n  - b lazy')
    expect(reading(savedUntouched('- a\n\n  - b\nlazy'))).toBe(reading('- a\n\n  - b\nlazy'))
  })
})

// Sweep, 2026-09-30: the same misreading one step further in. A marker four columns past an item's
// words after a blank line is the item's indented code, as CommonMark reads it, but it ended the
// list and was read at the margin as an item of its own: '- a\n\n      - b' saved as '- a\n\n- b',
// the code turned into a bullet.
describe('code four columns past an item’s words after a blank line', () => {
  it.each([
    ['that looks like a bullet', '- a\n\n      - b'],
    ['that looks like a numbered item, before the next item', '- a\n\n      1. b\n- c'],
    ['that looks like a rule', '- a\n\n      ---'],
    ['in a nested item', '- a\n  - b\n\n        - c']
  ])('keeps the code %s', (_name, markdown) => {
    expect(savedUntouched(markdown)).toBe(markdown)
    expect(reading(savedUntouched(markdown))).toBe(reading(markdown))
  })

  it('draws it as the item’s code', () => {
    const { editor } = openedSurface('- a\n\n      - b')
    expect(editor.querySelector('li > pre')?.textContent).toBe('- b')
  })
})
