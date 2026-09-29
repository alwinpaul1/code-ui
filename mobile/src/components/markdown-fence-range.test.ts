import { describe, expect, it } from 'vitest'
import { markdownFenceRanges } from './markdown-fence-range'

const end = (lines: string[], index = 0): number | null => markdownFenceRanges(lines).get(index) ?? null

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

// Third review (2026-09-29): tabs counted one column, where marked expands
// them to the next multiple of four; and finding a fence's list item walked
// back over the document for every fence, which the normalizer does on every
// streamed tick.
describe('fence ranges, tabs and cost', () => {
  it('counts a tab to the next multiple of four columns', () => {
    expect(end(['1.\t```html', '\t<b>x</b>', '\t```', 'after'])).toBe(3)
    expect(end(['- ```go', '\tfmt.Println("<b>hi</b>")', '  ```'])).toBe(3)
    expect(end(['Intro', '', '\t```', 'x'], 2)).toBeNull()
    expect(end(['```md', '\t```', 'x', '```', 'after'])).toBe(4)
  })

  it('reads a fence the next item has outdented as one at the margin', () => {
    expect(end(['9. a', '10. b', '   ```', 'x', '```', 'after'], 2)).toBe(5)
  })

  it('reads each line a bounded number of times, however many fences one item holds', () => {
    const fence = ['   ```sh', '   echo <b>hi</b>', '   ```', '']
    const source = ['1. one item', '', ...Array.from({ length: 1000 }, () => fence).flat()]
    let reads = 0
    const counted = new Proxy(source, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) {
          reads += 1
        }
        return Reflect.get(target, key, receiver)
      }
    })
    expect(markdownFenceRanges(counted).size).toBe(1000)
    expect(reads).toBeLessThanOrEqual(4 * source.length)
  })
})
