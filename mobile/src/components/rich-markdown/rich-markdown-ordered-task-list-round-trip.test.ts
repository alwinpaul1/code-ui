// @vitest-environment happy-dom
import { marked } from 'marked'
import { describe, expect, it } from 'vitest'
import { openedSurface, savedUntouched } from './rich-markdown-round-trip.test-support'

/** marked's reading of a document, whitespace aside. */
const reading = (source: string) =>
  marked.parse(source, { async: false }).replace(/\s+/g, ' ').replace(/> </g, '><').trim()

// Review, 2026-09-30: a numbered checklist saved as a bulleted one. '1. [ ] a\n2. [x] b' saved as
// '- [ ] a\n- [x] b': every task list was drawn as the bulleted kind, and a save writes that kind
// with `- `, so the numbering was gone.
describe('a numbered task list', () => {
  it.each([
    ['of two items', '1. [ ] a\n2. [x] b'],
    ['of one item, numbered from 3 with a parenthesis', '3) [ ] a'],
    ['numbered from 3 with parentheses', '3) [ ] a\n4) [x] b'],
    ['holding a nested task', '1. [ ] a\n   - [x] b\n2. [ ] c'],
    ['holding a nested task after a blank line', '1. [ ] a\n\n   - [x] b'],
    ['after a numbered list of words', '1. a\n\n2. [ ] b']
  ])('keeps its numbers %s', (_name, markdown) => {
    expect(savedUntouched(markdown)).toBe(markdown)
    expect(reading(savedUntouched(markdown))).toBe(reading(markdown))
  })

  it('is read as a numbered task list once saved', () => {
    expect(reading(savedUntouched('3) [ ] a\n4) [x] b'))).toBe(
      '<ol start="3"><li><input disabled="" type="checkbox"> a</li>' +
        '<li><input checked="" disabled="" type="checkbox"> b</li></ol>'
    )
  })

  it('still draws its checkboxes', () => {
    const { editor } = openedSurface('1. [ ] a\n2. [x] b')
    const boxes = Array.from(editor.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    expect(boxes.map((box) => box.checked)).toEqual([false, true])
    expect(editor.querySelector('[data-type="taskList"]')).not.toBeNull()
  })

  it('keeps its numbers when a box is ticked', () => {
    const { editor, saved } = openedSurface('1. [ ] a\n2. [x] b')
    editor.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked = true
    expect(saved()).toBe('1. [x] a\n2. [x] b')
  })

  it('keeps its numbers when an item’s words are edited', () => {
    const { editor, saved } = openedSurface('3) [ ] a\n4) [x] b')
    editor.querySelector('li > div > p')!.textContent = 'a, edited'
    expect(saved()).toBe('3) [ ] a, edited\n4) [x] b')
  })

  it('keeps a numbered list and a bulleted task list after it apart', () => {
    const markdown = '1. [ ] a\n- [ ] b'
    expect(reading(savedUntouched(markdown))).toBe(reading(markdown))
  })

  it('leaves a bulleted task list bulleted', () => {
    expect(savedUntouched('- [ ] a\n- [x] b')).toBe('- [ ] a\n- [x] b')
  })
})

describe('a numbered list written with parentheses', () => {
  it.each([
    ['of one item', '3) a'],
    ['of two items', '1) a\n2) b'],
    ['nested under a bullet', '- a\n  1) b']
  ])('keeps its parentheses %s', (_name, markdown) => {
    expect(savedUntouched(markdown)).toBe(markdown)
  })
})
