// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { openedSurface, savedUntouched } from './rich-markdown-round-trip.test-support'

// Review, 2026-09-30: a file that opens with YAML front matter (a SKILL.md, a docs page, a blog
// post) was read as a rule, a paragraph and a rule, and the paragraph's reflow joined the keys:
// '---\nname: x\ndescription: y\n---\n\n# Title' saved as
// '---\n\nname: x description: y\n\n---\n\n# Title', which is no YAML at all, so an edit anywhere in
// the file broke the skill's or the site's metadata. Front matter is shown as it is written and
// saved byte for byte; the editor does not edit it.
const SKILL = '---\nname: x\ndescription: y\n---\n\n# Title'

describe('front matter, from markdown and back', () => {
  it.each([
    ['a skill header', SKILL],
    ['a block closed by three dots', '---\ntitle: a\n...\n\nbody'],
    ['an empty block', '---\n---\n\n# Title'],
    ['nothing but front matter', '---\nname: x\n---'],
    ['a list, a quote and blank lines in the YAML', '---\ntags:\n  - a\n  - b\n\nnote: >\n  folded   text\n---\n\nbody'],
    ['entities and markdown marks in the YAML', '---\ntitle: "**not bold** &amp; <x>"\n---\n\nbody'],
    ['a later rule, which stays a rule', '---\nname: x\n---\n\nabove\n\n---\n\nbelow']
  ])('saves %s back as written', (_name, markdown) => {
    expect(savedUntouched(markdown)).toBe(markdown)
  })

  it('shows the front matter as it is written, and keeps it out of the editable text', () => {
    const { editor } = openedSurface(SKILL)
    const block = editor.firstElementChild!
    expect(block.textContent).toBe('---\nname: x\ndescription: y\n---')
    expect(block.getAttribute('contenteditable')).toBe('false')
    expect(editor.querySelector('hr')).toBeNull()
    expect(editor.querySelector('h1')?.textContent).toBe('Title')
  })

  it('saves the front matter unchanged when the text after it is typed into or deleted', () => {
    const { editor, saved } = openedSurface(SKILL)
    const title = editor.querySelector('h1')!
    title.textContent = 'Title, edited'
    expect(saved()).toBe('---\nname: x\ndescription: y\n---\n\n# Title, edited')
    title.remove()
    expect(saved()).toBe('---\nname: x\ndescription: y\n---')
    editor.append(Object.assign(document.createElement('p'), { textContent: 'typed after' }))
    expect(saved()).toBe('---\nname: x\ndescription: y\n---\n\ntyped after')
  })

  it('reads a first-line rule that nothing closes as a rule', () => {
    const { editor, saved } = openedSurface('---\nname: x')
    expect(editor.querySelector('hr')).not.toBeNull()
    expect(saved()).toBe('---\n\nname: x')
  })

  it('reads three dashes that do not open the document as a rule or an underline, not front matter', () => {
    const { editor } = openedSurface('\n---\nname: x\n---')
    expect(editor.querySelector('[contenteditable="false"]')).toBeNull()
  })
})
