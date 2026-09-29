import { describe, expect, it } from 'vitest'
import { markdownFenceEnd } from './markdown-fence-range'

const end = (lines: string[], index = 0): number | null => markdownFenceEnd(lines, index)

// Where the HTML pass must leave code alone (mobile-markdown-preview-html.ts);
// every case is a shape an agent's reply takes, read the way marked reads it.
describe('where a fenced code block ends in the source', () => {
  it('finds nothing in an empty source or on a blank line', () => {
    expect(end([])).toBeNull()
    expect(end([''])).toBeNull()
  })

  it('runs a lone opener to the end of the source while it streams', () => {
    expect(end(['```'])).toBe(1)
    expect(end(['```ts', 'const a = 1'])).toBe(2)
  })

  it('ends at a closer of the same character at least as long', () => {
    expect(end(['```', 'a', '```'])).toBe(3)
    expect(end(['````', '```', 'a', '```', '````', 'after'])).toBe(5)
    expect(end(['~~~', '```', '~~~~', 'after'])).toBe(3)
    expect(end(['```', 'a', '```  ', 'after'])).toBe(3)
  })

  it('does not close on a run with more after it', () => {
    expect(end(['```', '```js', 'a'])).toBe(3)
  })

  it('takes no one-line backtick span for a fence', () => {
    expect(end(['```a<b>c```'])).toBeNull()
    expect(end(['~~~a~~~', 'b', '~~~'])).toBe(3)
  })

  it('keeps a fence under a list item to that item', () => {
    const lines = ['1. step', '', '   ```sh', '   echo hi', '   ```', '2. next']
    expect(end(lines, 2)).toBe(5)
    // The next item ends one with no closer, as marked does.
    expect(end(['- ```sh', '  echo hi', '- next'], 0)).toBe(2)
    expect(end(['1. step', '   ```sh', '   echo hi', 'After'], 1)).toBe(3)
  })

  it('finds the item through its continuation paragraphs', () => {
    expect(end(['1. step', '', '   more', '', '     ```sh', '     echo', '     ```'], 4)).toBe(7)
  })

  it('does not close on a run indented four columns into the item', () => {
    const lines = ['- step', '', '  ```md', '  text', '      ```', '  <b>code</b>', '  ```', 'after']
    expect(end(lines, 2)).toBe(7)
  })

  it('takes a run four columns past its container for an indented code block', () => {
    expect(end(['    ```'])).toBeNull()
    expect(end(['Intro', '    ```js', 'x'], 1)).toBeNull()
    expect(end(['- item', '', '      ```', 'x'], 2)).toBeNull()
  })
})
