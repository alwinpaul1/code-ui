import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { parseMarkdownBlocks, type MarkdownBlock } from './markdown-blocks'

// Review, 2026-09-30: bot review comments nest collapsibles, and a <details>
// inside a <details> closed the outer one at the INNER closing tag. The
// inner opener and summary drew as a paragraph of raw tags, and everything
// after the inner block fell out of the outer collapsible.

const NESTED = '<details>\n<summary>Outer</summary>\n\nintro\n\n<details>\n<summary>Inner</summary>\n\ndeep\n\n</details>\n\ntail\n\n</details>'

/** Every paragraph's and quote's text, however deep. */
function texts(blocks: MarkdownBlock[]): string[] {
  return blocks.flatMap((block) =>
    block.kind === 'details'
      ? [block.summary, ...texts(block.body)]
      : block.kind === 'paragraph' || block.kind === 'quote'
        ? [block.text]
        : []
  )
}

describe('a <details> inside a <details>', () => {
  it('keeps the inner collapsible and the text after it inside the outer one', () => {
    expect(parseMarkdownBlocks(NESTED)).toEqual([
      {
        kind: 'details',
        summary: 'Outer',
        body: [
          { kind: 'paragraph', text: 'intro' },
          { kind: 'details', summary: 'Inner', body: [{ kind: 'paragraph', text: 'deep' }] },
          { kind: 'paragraph', text: 'tail' }
        ]
      }
    ])
  })

  it('shows no literal tag anywhere', () => {
    for (const text of texts(parseMarkdownBlocks(NESTED))) {
      expect(text).not.toMatch(/<\/?(details|summary)/)
    }
  })

  it('nests three deep and keeps the text after the outer block outside it', () => {
    const md = '<details><summary>A</summary>\n\n<details><summary>B</summary>\n\n<details><summary>C</summary>\n\nc\n\n</details>\n\nb\n\n</details>\n\na\n\n</details>\n\nafter'
    expect(parseMarkdownBlocks(md)).toEqual([
      {
        kind: 'details',
        summary: 'A',
        body: [
          {
            kind: 'details',
            summary: 'B',
            body: [
              { kind: 'details', summary: 'C', body: [{ kind: 'paragraph', text: 'c' }] },
              { kind: 'paragraph', text: 'b' }
            ]
          },
          { kind: 'paragraph', text: 'a' }
        ]
      },
      { kind: 'paragraph', text: 'after' }
    ])
  })

  it('does not take the inner summary for the title of an outer block that has none', () => {
    const md = '<details>\n\nintro\n\n<details><summary>Inner</summary>\n\ndeep\n\n</details>\n\n</details>'
    expect(parseMarkdownBlocks(md)).toEqual([
      {
        kind: 'details',
        summary: 'Details',
        body: [
          { kind: 'paragraph', text: 'intro' },
          { kind: 'details', summary: 'Inner', body: [{ kind: 'paragraph', text: 'deep' }] }
        ]
      }
    ])
  })

  it('takes an outer summary written after the inner block, as a browser does', () => {
    const md = '<details>\n<details><summary>Inner</summary>\n\ndeep\n\n</details>\n<summary>Outer</summary>\n\nx\n\n</details>'
    const [block] = parseMarkdownBlocks(md)
    expect(block).toMatchObject({ kind: 'details', summary: 'Outer' })
    expect(texts([block!])).toEqual(['Outer', 'Inner', 'deep', 'x'])
  })

  it('draws a <blockquote> inside a <details> as a quote in its body', () => {
    const md = '<details><summary>S</summary>\n\n<blockquote>q</blockquote>\n\nafter\n\n</details>'
    expect(parseMarkdownBlocks(md)).toEqual([
      {
        kind: 'details',
        summary: 'S',
        body: [
          { kind: 'quote', text: 'q' },
          { kind: 'paragraph', text: 'after' }
        ]
      }
    ])
  })

  it('draws a <details> inside a <blockquote> as the quote\'s text, tags off', () => {
    const md = '<blockquote>\nsaid\n<details><summary>S</summary>\nbody\n</details>\nend\n</blockquote>\n\nafter'
    expect(parseMarkdownBlocks(md)).toEqual([
      { kind: 'quote', text: 'said\nS\nbody\n\nend' },
      { kind: 'paragraph', text: 'after' }
    ])
  })

  it('keeps a <blockquote> inside a <blockquote> in the outer quote', () => {
    const md = '<blockquote>a <blockquote>b</blockquote> c</blockquote>\n\nafter'
    expect(parseMarkdownBlocks(md)).toEqual([
      { kind: 'quote', text: 'a b c' },
      { kind: 'paragraph', text: 'after' }
    ])
  })

  // Guards: unbalanced input reads as it did, and nothing throws.
  it('closes an outer opener with no balancing closer at the first closer, as before', () => {
    const md = '<details>\n<summary>A</summary>\n\nx\n\n<details>\n\ny\n\n</details>\n\ntail'
    expect(parseMarkdownBlocks(md)).toEqual([
      {
        kind: 'details',
        summary: 'A',
        body: [
          { kind: 'paragraph', text: 'x' },
          { kind: 'paragraph', text: '<details>' },
          { kind: 'paragraph', text: 'y' }
        ]
      },
      { kind: 'paragraph', text: 'tail' }
    ])
  })

  it('leaves an opener with no closer at all, and a stray closer, as text', () => {
    expect(parseMarkdownBlocks('<details>\n\nx')).toEqual([
      { kind: 'paragraph', text: '<details>' },
      { kind: 'paragraph', text: 'x' }
    ])
    expect(parseMarkdownBlocks('x\n\n</details>')).toEqual([
      { kind: 'paragraph', text: 'x' },
      { kind: 'paragraph', text: '</details>' }
    ])
  })

  it('opens nothing on a tag inside a fence, even nested', () => {
    const md = '<details><summary>S</summary>\n\n```html\n<details>\n</details>\n```\n\nafter\n\n</details>'
    expect(parseMarkdownBlocks(md)).toEqual([
      {
        kind: 'details',
        summary: 'S',
        body: [
          { kind: 'code', text: '<details>\n</details>', lang: 'html' },
          { kind: 'paragraph', text: 'after' }
        ]
      }
    ])
  })

  it('reads an empty collapsible and one inside another with nothing in it', () => {
    expect(parseMarkdownBlocks('<details></details>')).toEqual([{ kind: 'details', summary: 'Details', body: [] }])
    expect(parseMarkdownBlocks('<details><details></details></details>')).toEqual([
      { kind: 'details', summary: 'Details', body: [{ kind: 'details', summary: 'Details', body: [] }] }
    ])
  })

  it('nests sixteen deep and leaves the tags of any deeper level in its text', () => {
    let blocks = parseMarkdownBlocks(`${'<details>'.repeat(20)}x${'</details>'.repeat(20)}`)
    let depth = 0
    while (blocks.length === 1 && blocks[0]!.kind === 'details') {
      depth += 1
      blocks = blocks[0]!.body
    }
    expect(depth).toBe(16)
    expect(blocks).toEqual([{ kind: 'paragraph', text: `${'<details>'.repeat(4)}x${'</details>'.repeat(4)}` }])
  })

  it.each([
    { name: 'thousands of openers and no closer', text: '<details>\n'.repeat(20_000) },
    { name: 'thousands of openers then as many closers', text: `${'<details>'.repeat(10_000)}x${'</details>'.repeat(10_000)}` },
    { name: 'thousands of openers then one closer', text: `${'<details>\n'.repeat(20_000)}</details>` },
    { name: 'openers that never end their tag', text: '<details '.repeat(20_000) },
    { name: 'summaries that never close', text: `<details>${'<summary>'.repeat(20_000)}</details>` },
    { name: 'blockquotes in turn with details', text: '<blockquote><details>'.repeat(8_000) }
  ])('reads $name within the parser deadline', ({ text }) => {
    const blocks = runInNewContext('parse(text)', { parse: parseMarkdownBlocks, text }, { timeout: 500 })
    expect(Array.isArray(blocks)).toBe(true)
  })
})
