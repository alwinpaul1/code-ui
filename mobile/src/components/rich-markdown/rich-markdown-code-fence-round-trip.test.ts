// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { editedSurface, openedSurface, savedUntouched } from './rich-markdown-round-trip.test-support'

// Review, 2026-09-30: the editor opened a fence only on backticks followed by one word
// (/^(`{3,})([^\s`]*)\s*$/). A fence whose info string holds a space, `ts title="a b.ts"`,
// `json {1,3}` or `bash foo`, and every `~~~` fence, was read as paragraphs, and their reflow
// rewrote the code on the next save: '~~~sh\nls -a\n\necho hi\n~~~' saved as
// '~~~sh ls -a\n\necho hi ~~~'. CommonMark's rules: backticks or tildes, three or more, up to three
// columns in; a backtick fence's info string holds no backtick, a tilde fence's may; the closing
// fence is the same character, at least as long, up to three columns in; an unclosed fence runs to
// the end of the document.
describe('a fenced code block, from markdown and back', () => {
  it.each([
    ['an info string with a quoted title', '```ts title="a b.ts"\nconst a = 1\n\nconst b = 2\n```'],
    ['a tilde fence', '~~~sh\nls -a\n\necho hi\n~~~'],
    ['line highlights after the language', '```json {1,3}\n{\n  "a": 1\n}\n```'],
    ['a second word after the language', '```bash foo\nls\n```'],
    ['a tilde fence around backtick fences', '~~~md\n```js\nx\n```\n~~~'],
    ['a tilde fence whose info string holds a backtick', '~~~ a`b\nx\n~~~'],
    ['a four-tilde fence', '~~~~\n~~~\nx\n~~~~'],
    ['a fence longer than its code needs', '`````\nplain\n`````'],
    ['a fence three columns in', '   ```\n   code\n\n   more\n   ```'],
    ['an entity-looking info string', '```a&amp;b\nx\n```'],
    ['a closing fence of the other character inside', '```\nx\n~~~\n```'],
    ['a closing fence four columns in, which is code', '```\nx\n    ```\n```']
  ])('keeps %s as a code block and saves it back as written', (_name, markdown) => {
    const { editor, saved } = openedSurface(markdown)
    expect(editor.querySelectorAll('pre')).toHaveLength(1)
    expect(saved()).toBe(markdown)
  })

  it('labels the block with the first word of its info string', () => {
    const { editor } = openedSurface('```ts title="a b.ts"\nconst a = 1\n```')
    expect(editor.querySelector('pre')!.getAttribute('data-language')).toBe('ts')
    expect(editor.querySelector('code')!.textContent).toBe('const a = 1')
  })

  it('ends the block at a closing fence up to three columns in, longer than the opening', () => {
    expect(savedUntouched('```\nx\n   ```\nafter')).toBe('```\nx\n```\n\nafter')
    expect(savedUntouched('~~~\nx\n~~~~~\nafter')).toBe('~~~\nx\n~~~\n\nafter')
  })

  it('runs an unclosed fence to the end of the document and closes it on save', () => {
    const { editor, saved } = openedSurface('~~~\nx\n\n# not a heading')
    expect(editor.querySelector('h1')).toBeNull()
    expect(editor.querySelector('code')!.textContent).toBe('x\n\n# not a heading')
    expect(saved()).toBe('~~~\nx\n\n# not a heading\n~~~')
  })

  it('ends a paragraph at a tilde fence, as it does at a backtick one', () => {
    expect(savedUntouched('text\n~~~\ncode\n~~~')).toBe('text\n\n~~~\ncode\n~~~')
    expect(savedUntouched('text\n  ```\n  code\n  ```')).toBe('text\n\n  ```\n  code\n  ```')
  })

  it('reads a backtick run whose info string holds a backtick as text', () => {
    const { editor, saved } = openedSurface('```a`b')
    expect(editor.querySelector('pre')).toBeNull()
    expect(saved()).toBe('```a`b')
  })

  it('keeps the info string and the tildes when the code is edited', () => {
    const { editor, saved } = openedSurface('~~~ts title="a b.ts"\nconst a = 1\n~~~')
    editor.querySelector('code')!.textContent = 'const a = 2'
    expect(saved()).toBe('~~~ts title="a b.ts"\nconst a = 2\n~~~')
  })

  it('lengthens a remembered fence once the code holds a line that would close it', () => {
    const tilde = openedSurface('~~~\nx\n~~~')
    tilde.editor.querySelector('code')!.textContent = 'x\n~~~\ny'
    expect(tilde.saved()).toBe('~~~~\nx\n~~~\ny\n~~~~')

    const backtick = openedSurface('`````\nplain\n`````')
    backtick.editor.querySelector('code')!.textContent = '``````\nplain'
    expect(backtick.saved()).toBe('```````\n``````\nplain\n```````')
  })

  it('still lengthens a fence the toolbar made when its code holds a backtick run', () => {
    expect(
      editedSurface('<pre data-language=""><code>a ``` b</code></pre>').saved()
    ).toBe('````\na ``` b\n````')
  })
})
