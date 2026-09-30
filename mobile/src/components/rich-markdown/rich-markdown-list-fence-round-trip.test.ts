// @vitest-environment happy-dom
import { marked, type Tokens } from 'marked'
import { describe, expect, it } from 'vitest'
import { editedSurface, openedSurface, savedUntouched } from './rich-markdown-round-trip.test-support'

// Review, 2026-09-30: a fenced code block inside a list item, the commonest shape in a CLAUDE.md
// or a README, was taken for the item's wrapped words and reflowed:
// '- a\n  ```\n  code\n  ```\n- b' saved as '- a ``` code ```\n- b'. The item now holds the block
// (a `<pre>` inside the `<li>`), and a save writes it back at the item's content column.
describe('a fenced code block inside a list item', () => {
  it.each([
    ['under a bullet', '- a\n  ```\n  code\n  ```\n- b'],
    ['under an ordered item', '1. a\n   ```\n   x\n   ```'],
    ['under an item numbered past 9', '10. a\n    ```sh\n    ls\n    ```\n11. b'],
    ['with blank lines inside it', '- a\n  ```\n  x\n\n  y\n\n  z\n  ```\n- b'],
    ['on the item’s own first line', '- ```\n  code\n  ```\n- b'],
    ['on an ordered item’s own first line', '1. ```ts\n   const a = 1\n   ```'],
    ['after a blank line in the item', '- a\n\n  ```\n  x\n  ```\n- b'],
    ['four columns under `1. `', '1. a\n    ```\n    x\n    ```\n2. b'],
    ['with a tilde fence and an info string', '- a\n  ~~~ts title="x"\n  y\n  ~~~'],
    ['in a nested item', '- a\n  - b\n    ```\n    x\n    ```\n- c'],
    ['after a nested list, in the outer item', '- a\n  - b\n  ```\n  x\n  ```\n- c'],
    ['before a nested list', '- a\n  ```\n  x\n  ```\n  - b'],
    ['with code lines indented further', '- a\n  ```py\n  if x:\n      y()\n  ```'],
    ['under a task', '- [ ] a\n  ```\n  x\n  ```\n- [x] b']
  ])('saves a fence %s back as written', (_name, markdown) => {
    expect(savedUntouched(markdown)).toBe(markdown)
  })

  it('draws the fence as a code block inside its item, and the next item as a sibling', () => {
    const { editor } = openedSurface('- a\n  ```\n  code\n  ```\n- b')
    const items = editor.querySelectorAll('ul > li')
    expect(items).toHaveLength(2)
    expect(items[0]!.querySelector('pre > code')!.textContent).toBe('code')
    expect(items[0]!.querySelector('p')!.textContent).toBe('a')
  })

  it('keeps the item one item for a CommonMark reader once saved', () => {
    const saved = savedUntouched('1. a\n   ```\n   x\n   ```\n2. b')
    const list = marked.lexer(saved).find((token) => token.type !== 'space')
    expect(list?.type).toBe('list')
    const items = (list as Tokens.List).items
    expect(items.map((item: Tokens.ListItem) => item.tokens.map((inner) => inner.type))).toEqual([
      ['text', 'code'],
      ['text']
    ])
  })

  it('ends the item at a fence written left of its words, which is the document’s', () => {
    const { editor, saved } = openedSurface('- a\n ```\n x\n ```')
    expect(editor.querySelector('li pre')).toBeNull()
    expect(editor.querySelector(':scope > pre')).not.toBeNull()
    expect(saved()).toBe('- a\n\n ```\n x\n ```')
  })

  it('keeps a code line that starts with a tab inside its item’s fence', () => {
    // A tab is four columns, past the item's two, so the line is the fence's: reading only spaces
    // as indent ended the item there, and the rest of the document became an unclosed fence. The
    // two columns of the tab past the item's are the code's, as CommonMark and marked read them.
    const markdown = '- a\n  ```make\n  all:\n\tgo build\n  ```\n- b'
    const { editor, saved } = openedSurface(markdown)
    expect(editor.querySelectorAll('ul > li')).toHaveLength(2)
    expect(editor.querySelector('li pre code')?.textContent).toBe('all:\n  go build')
    const html = (source: string) => marked.parse(source, { async: false })
    expect(html(saved())).toBe(html(markdown))
  })

  it('ends an unclosed fence with its item, and closes it on save', () => {
    expect(savedUntouched('- a\n  ```\n  x\n- b')).toBe('- a\n  ```\n  x\n  ```\n- b')
  })

  it('keeps the fence when the item’s words are edited, and the words when the code is', () => {
    const { editor, saved } = openedSurface('- a\n  ```\n  code\n  ```\n- b')
    editor.querySelector('li > p')!.textContent = 'a, edited'
    editor.querySelector('li code')!.textContent = 'code, edited'
    expect(saved()).toBe('- a, edited\n  ```\n  code, edited\n  ```\n- b')
  })

  it('writes a code block the engine put in an item at the item’s content column', () => {
    expect(
      editedSurface('<ol start="9"><li><p>a</p><pre data-language=""><code>x</code></pre></li></ol>').saved()
    ).toBe('9. a\n   ```\n   x\n   ```')
  })
})
