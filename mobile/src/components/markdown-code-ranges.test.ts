import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { markdownCodeRanges } from './markdown-code-ranges'

const end = (lines: string[], index = 0): number | null => markdownCodeRanges(lines).get(index) ?? null

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

// Fourth review (2026-09-29): an indented code block is code too, and it went
// through the HTML pass in every version, so `<div>x</div>` drew and copied
// as `x`. Same defect as the fences, so the same pass protects it.
describe('where an indented code block ends in the source', () => {
  const code = (lines: string[], index = 0): number | null =>
    markdownCodeRanges(lines, { indentedCode: true }).get(index) ?? null

  it('finds nothing on a blank line of spaces', () => {
    expect(code(['    '])).toBeNull()
  })

  it('runs over its indented and blank lines, and stops before the text after it', () => {
    expect(code(['    only'])).toBe(1)
    expect(code(['Run:', '', '    <div>x</div>', '', '    y', '', 'after'], 2)).toBe(5)
  })

  it('takes an indented line right after a paragraph for that paragraph', () => {
    expect(code(['Intro', '    not code'], 1)).toBeNull()
    expect(code(['<p align="center">', '    <img src="logo.png">', '</p>'], 1)).toBeNull()
  })

  it('finds one inside a list item, four columns past its content', () => {
    expect(code(['- item', '', '      <b>x</b>', '  more'], 2)).toBe(3)
    expect(code(['-     ```html', '      <b>x</b>', '      ```', 'after'])).toBe(3)
  })

  it('is left alone unless asked for, as in a fragment the HTML pass cuts out', () => {
    expect(end(['Run:', '', '    <div>x</div>'], 2)).toBeNull()
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

  // Fourth review (2026-09-29): `- - -` is a rule, not an item; a line after a
  // blank that is less indented than the item's content ends the item; and a
  // line at the margin right after an item's text is a lazy continuation of it.
  it('reads the list items the way marked does around a fence', () => {
    expect(end(['Intro', '- - -', '  ```sh', 'echo hi', '  ```', 'after'], 2)).toBe(5)
    expect(end(['- item', '', ' para', '  ```sh', 'x', '  ```', 'after'], 3)).toBe(6)
    expect(end(['1. step', 'lazy', '   ```sh', 'x', '   ```'], 2)).toBe(3)
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
    expect(markdownCodeRanges(counted).size).toBe(1000)
    expect(reads).toBeLessThanOrEqual(4 * source.length)
  })
})

// Review, 2026-09-30 (two reviewers): a `>` line read as paragraph text, so a
// fence inside a quote was not protected and the HTML pass rewrote its code:
// `<b>x</b>` became `**x**`, `<Text>` went, `&amp;` became `&`. The same
// defect 0.9.106 fixed for a fence inside a list. Each shape below is read
// the way marked reads it (checked against marked's lexer).
describe('where a fenced code block inside a quote ends', () => {
  it('finds a fence in a quote and ends it at its closer', () => {
    expect(end(['> ```', '> <b>x</b> &amp;', '> ```'])).toBe(3)
    expect(end(['> ```tsx', '> <Text>a</Text>', '> ```', 'after <b>y</b>'])).toBe(3)
    expect(end(['Intro', '', '> ~~~', '> <b>x</b>', '> ~~~'], 2)).toBe(5)
  })

  it('reads `>` with or without the space after it, up to three spaces in, and nested', () => {
    expect(end(['>```', '><b>x</b>', '>```'])).toBe(3)
    expect(end(['>\t```', '>\t<b>x</b>', '>\t```'])).toBe(3)
    expect(end(['   > ```', '   > <b>x</b>', '   > ```'])).toBe(3)
    expect(end(['> > ```', '> > <b>x</b>', '> > ```'])).toBe(3)
    expect(end(['>> ```', '>> <b>x</b>', '>> ```'])).toBe(3)
  })

  it('ends an unclosed quoted fence at the first line that leaves its quote', () => {
    expect(end(['> ```', '> <b>x</b>', '<b>y</b>'])).toBe(2)
    expect(end(['> ```', '> <b>x</b>', '', '> <b>y</b>'])).toBe(2)
    expect(end(['> > ```', '> > <b>x</b>', '> <b>y</b>'])).toBe(2)
  })

  it('closes a quoted fence only inside the same quote', () => {
    // A deeper `>` inside the fence is its code, not a closer's quote.
    expect(end(['> ```', '> > ```', '> ```', 'after'])).toBe(3)
    expect(end(['> ```', '```', '> <b>x</b>'])).toBe(1)
  })

  it('reads the degenerate sizes: an empty fence, an opener on the last line, a one-line quote', () => {
    expect(end(['> ```', '> ```'])).toBe(2)
    expect(end(['> ```'])).toBe(1)
    expect(end(['> para', '> ```'], 1)).toBe(2)
    expect(end(['> <b>x</b>'])).toBeNull()
    expect(end(['>'])).toBeNull()
  })

  it('finds a quoted fence inside a list item, and a list fence inside a quote', () => {
    expect(end(['- item', '  > ```', '  > <b>x</b>', '  > ```', 'after'], 1)).toBe(4)
    expect(end(['> - item', '>   ```', '>   <b>x</b>', '>   ```', 'after'], 1)).toBe(4)
  })

  it('reads a lazy line after a quote as it did', () => {
    expect(end(['> para', 'lazy', '> ```', '> <b>x</b>', '> ```'], 2)).toBe(5)
    expect(end(['> para', '```', '<b>x</b>', '```'], 1)).toBe(4)
  })

  it('ends the list items a quote marker is not indented into', () => {
    // marked ends the list at `> note`; four columns in, the next lines are
    // the quote's paragraph, so their HTML is prose, not code.
    expect(end(['1. step', '> note', '    ```sh', '    <b>x</b>', '    ```'], 2)).toBeNull()
    expect(end(['1. step', '> note', '   ```sh', '   echo <b>hi</b>', '   ```'], 2)).toBe(5)
  })

  it('takes an indented block inside a quote for code when asked', () => {
    const code = markdownCodeRanges(['>     <b>x</b>', '>     y', 'after'], { indentedCode: true })
    expect(code.get(0)).toBe(2)
    expect(markdownCodeRanges(['>     <b>x</b>']).get(0)).toBeUndefined()
  })

  it('reads a quote nested past any document inside the deadline, and a fence far down as text', () => {
    // The parser hands such a document back as prose (RUNAWAY_NESTING), so
    // there is no code block down there to protect.
    const deep = `${'> '.repeat(12_000)}\`\`\``
    const ranges = runInNewContext('find(lines)', { find: markdownCodeRanges, lines: [deep, deep] }, { timeout: 250 })
    expect(ranges.size).toBe(0)
  })

  it('reads each line a bounded number of times, however many fences one quote holds', () => {
    const fence = ['> ```sh', '> echo <b>hi</b>', '> ```', '>']
    const source = ['> Steps:', '>', ...Array.from({ length: 1000 }, () => fence).flat()]
    let reads = 0
    const counted = new Proxy(source, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) {
          reads += 1
        }
        return Reflect.get(target, key, receiver)
      }
    })
    expect(markdownCodeRanges(counted).size).toBe(1000)
    expect(reads).toBeLessThanOrEqual(4 * source.length)
  })
})
