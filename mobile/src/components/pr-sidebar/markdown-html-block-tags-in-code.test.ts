import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdownBlocks } from './markdown-blocks'

// Review, 2026-09-30 (fix round 3): a PR comment about HTML syntax, 'Use
// `<details>` to open and `</details>` to close it.', drew as the paragraph
// 'Use `', a collapsible titled "Details" holding '` to open and `', and the
// paragraph '` to close it.': words lost and stray backticks drawn. With
// <blockquote> the same sentence drew a quote. The <details>/<blockquote>
// split (markdown-html-blocks.ts) read tags inside inline code; the inline
// pass keeps them as code, and GitHub draws the sentence as one paragraph.

const paragraph = (text: string) => ({ kind: 'paragraph', text })

describe('a PR comment that names <details> or <blockquote> in inline code', () => {
  it('keeps the sentence one paragraph with both code spans, for <details>', () => {
    const text = 'Use `<details>` to open and `</details>` to close it.'
    expect(parseMarkdownBlocks(text)).toEqual([paragraph(text)])
    expect(parseInline(text).filter((token) => token.kind === 'code')).toEqual([
      { kind: 'code', text: '<details>' },
      { kind: 'code', text: '</details>' }
    ])
  })

  it('keeps the sentence one paragraph with both code spans, for <blockquote>', () => {
    const text = 'Use `<blockquote>` to open and `</blockquote>` to close it.'
    expect(parseMarkdownBlocks(text)).toEqual([paragraph(text)])
  })

  it('keeps a code span that runs over a line break inside its paragraph', () => {
    expect(parseMarkdownBlocks('Wrap it in `<details>\nand </details>` tags.')).toEqual([
      paragraph('Wrap it in `<details>\nand </details>` tags.')
    ])
  })

  it('keeps a comment that is only one code span, or one tag in one', () => {
    expect(parseMarkdownBlocks('`<details></details>`')).toEqual([paragraph('`<details></details>`')])
    expect(parseMarkdownBlocks('`<details>`')).toEqual([paragraph('`<details>`')])
    expect(parseMarkdownBlocks('`</blockquote>`')).toEqual([paragraph('`</blockquote>`')])
    expect(parseMarkdownBlocks('')).toEqual([])
  })

  it('keeps the code spans in a list item and a heading', () => {
    expect(parseMarkdownBlocks('- `<details>` opens\n- `</details>` closes')).toEqual([
      { kind: 'list', ordered: false, items: ['`<details>` opens', '`</details>` closes'] }
    ])
    expect(parseMarkdownBlocks('## `<blockquote>` vs `</blockquote>`')).toEqual([
      { kind: 'heading', level: 2, text: '`<blockquote>` vs `</blockquote>`' }
    ])
  })

  // The <summary> a collapsible takes is read the same way: one named in
  // code inside the body is words, not the title.
  it('takes no title from a <summary> named in code inside a collapsible', () => {
    expect(parseMarkdownBlocks('<details>\n\nTitle it with `<summary>Logs</summary>`.\n\n</details>')).toEqual([
      { kind: 'details', summary: 'Details', body: [paragraph('Title it with `<summary>Logs</summary>`.')] }
    ])
    expect(
      parseMarkdownBlocks('<details>\n\nNot `<summary>A</summary>` but this:\n\n<summary>B</summary>\n\nx\n\n</details>')
    ).toEqual([
      {
        kind: 'details',
        summary: 'B',
        body: [paragraph('Not `<summary>A</summary>` but this:'), paragraph('x')]
      }
    ])
  })
})

describe('a real <details> or <blockquote> beside inline code', () => {
  it('still opens after a sentence that names it in code', () => {
    expect(
      parseMarkdownBlocks('Use `<details>` like this:\n\n<details>\n<summary>Log</summary>\n\nx `y`\n\n</details>')
    ).toEqual([
      paragraph('Use `<details>` like this:'),
      { kind: 'details', summary: 'Log', body: [paragraph('x `y`')] }
    ])
    expect(parseMarkdownBlocks('`<blockquote>` draws:\n\n<blockquote>quoted `code`</blockquote>')).toEqual([
      paragraph('`<blockquote>` draws:'),
      { kind: 'quote', text: 'quoted `code`' }
    ])
  })

  it('still opens after a backtick that has no partner', () => {
    expect(parseMarkdownBlocks('Press ` then <details><summary>S</summary>\n\nbody\n\n</details>')).toEqual([
      paragraph('Press ` then'),
      { kind: 'details', summary: 'S', body: [paragraph('body')] }
    ])
    expect(parseMarkdownBlocks('\\`<blockquote>q</blockquote>`')).toEqual([
      paragraph('\\`'),
      { kind: 'quote', text: 'q' },
      paragraph('`')
    ])
  })

  it('pairs no backticks across a blank line, a heading or a fence around a real one', () => {
    expect(parseMarkdownBlocks('a ` b\n\nc <details><summary>S</summary>x</details> d\n\ne ` f')).toEqual([
      paragraph('a ` b'),
      paragraph('c'),
      { kind: 'details', summary: 'S', body: [paragraph('x')] },
      paragraph('d'),
      paragraph('e ` f')
    ])
    expect(parseMarkdownBlocks('# a `\nb <blockquote>q</blockquote> `c')).toEqual([
      { kind: 'heading', level: 1, text: 'a `' },
      paragraph('b'),
      { kind: 'quote', text: 'q' },
      paragraph('`c')
    ])
    expect(parseMarkdownBlocks('a `\n```\nx\n```\nb <blockquote>q</blockquote> `')).toEqual([
      paragraph('a `'),
      { kind: 'code', text: 'x', lang: '' },
      paragraph('b'),
      { kind: 'quote', text: 'q' },
      paragraph('`')
    ])
  })

  // Each list item, a quote and a table row is read as a block of its own,
  // so a stray backtick in one never pairs with one in the next.
  it('pairs no backticks across list items, into or out of a quote, or across table rows', () => {
    expect(parseMarkdownBlocks('- a ` b\n- c <blockquote>q</blockquote> ` d')).toEqual([
      { kind: 'list', ordered: false, items: ['a ` b', 'c'] },
      { kind: 'quote', text: 'q' },
      paragraph('` d')
    ])
    expect(parseMarkdownBlocks('p ` a\n> c <blockquote>q</blockquote> ` d')).toEqual([
      paragraph('p ` a'),
      { kind: 'quote', text: 'c' },
      { kind: 'quote', text: 'q' },
      paragraph('` d')
    ])
    // `c` is the quote's lazy line (markdown-lazy-lines.test.ts); it was a paragraph until
    // 2026-09-30. Its backtick is still no pair for the one after the tag.
    expect(parseMarkdownBlocks('> a ` b\nc <blockquote>q</blockquote> ` d')).toEqual([
      { kind: 'quote', text: 'a ` b\nc' },
      { kind: 'quote', text: 'q' },
      paragraph('` d')
    ])
    // Only that the tag is real: how this reader cuts a table around a
    // quote in a cell is its reading of any such tag, not this test's.
    const table = parseMarkdownBlocks('| a | b |\n| - | - |\n| ` | x |\n| y <blockquote>q</blockquote> | ` |')
    expect(table).toContainEqual({ kind: 'quote', text: 'q' })
  })

  it('still runs a span over the wrapped lines of one list item', () => {
    expect(parseMarkdownBlocks('- wrap `<details>\n  and </details>` here\n- next')).toEqual([
      { kind: 'list', ordered: false, items: ['wrap `<details> and </details>` here', 'next'] }
    ])
  })

  // GitHub reads a line that opens with a block tag, and the lines after it
  // up to a blank one, as HTML, where a backtick is a character: two stray
  // ones there must not hide the real closer between them.
  it('closes at its closer between two stray backticks in its HTML lines', () => {
    expect(
      parseMarkdownBlocks('<details><summary>Use the ` key</summary>\nSome text\n</details>\nLater `code` here.')
    ).toEqual([
      { kind: 'details', summary: 'Use the ` key', body: [paragraph('Some text')] },
      paragraph('Later `code` here.')
    ])
  })

  it('still reads a tag inside a fence as code', () => {
    expect(parseMarkdownBlocks('```html\n<details>\n```\n\nThen `</details>` closes it.')).toEqual([
      { kind: 'code', text: '<details>', lang: 'html' },
      paragraph('Then `</details>` closes it.')
    ])
  })
})

describe('a PR comment with thousands of tags in code spans', () => {
  it.each([
    { name: 'both tags in every span', text: '`<details>` `</details>` '.repeat(10_000) },
    { name: 'summaries in code in a collapsible', text: `<details>\n\n${'`<summary>` '.repeat(20_000)}</summary>\n\n</details>` },
    { name: 'a backtick before every opener', text: '` <details> '.repeat(20_000) },
    { name: 'spans across thousands of lines', text: '`<blockquote>\n</blockquote>`\n'.repeat(10_000) }
  ])('reads $name within the parser deadline', ({ text }) => {
    const blocks = runInNewContext('parse(text)', { parse: parseMarkdownBlocks, text }, { timeout: 500 })
    expect(Array.isArray(blocks)).toBe(true)
  })

  it('keeps every span of a long sentence in one paragraph', () => {
    const text = 'Use `<details>` and `</details>`. '.repeat(2_000).trim()
    expect(parseMarkdownBlocks(text)).toEqual([paragraph(text)])
  })
})
