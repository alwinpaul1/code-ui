import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { routeMarkdownHref } from './markdown-href-routing'
import { markdownLinkDestination } from './markdown-link-destination'
import { markdownInlinePlainText, markdownPlainText } from './markdown-plain-text'
import { parseInline } from './pr-sidebar/markdown-blocks'

// Review, 2026-09-30: a link with a title, '[the docs](https://x.dev/a "The
// docs")', opened 'https://x.dev/a "The docs"' in a chat reply and in a PR
// comment, while the reply's Copy already left the title out. One helper now
// takes the title off for all three (markdown-link-destination.ts). The tap
// in a chat reply is pinned in MobileMarkdown.link-title.test.tsx.

describe('a Markdown link with a title', () => {
  it('opens a chat link\'s address without its title', () => {
    expect(routeMarkdownHref('https://x.dev/a "The docs"')).toEqual({ kind: 'web', url: 'https://x.dev/a' })
    expect(routeMarkdownHref("https://x.dev/a 'The docs'")).toEqual({ kind: 'web', url: 'https://x.dev/a' })
    expect(routeMarkdownHref('https://x.dev/a "a \\"b\\" c"')).toEqual({ kind: 'web', url: 'https://x.dev/a' })
  })

  it('opens a file link\'s path without its title', () => {
    expect(routeMarkdownHref('src/a.ts "t"')).toEqual({ kind: 'file', pathText: 'src/a.ts' })
    expect(routeMarkdownHref('src/a.ts#L12 "the call"')).toEqual({ kind: 'file', pathText: 'src/a.ts:12' })
  })

  it('opens a PR comment link\'s address without its title', () => {
    expect(parseInline('[a](https://x.dev "T")')).toEqual([{ kind: 'link', text: 'a', url: 'https://x.dev' }])
    expect(parseInline('![shot](https://x.dev/i.png "Shot")')).toEqual([
      { kind: 'link', text: 'shot', url: 'https://x.dev/i.png' }
    ])
  })

  it('copies the same address it opens', () => {
    expect(markdownPlainText('[the docs](https://x.dev/a "The docs")')).toBe('the docs (https://x.dev/a)')
  })

  // The documented rule stays: only a quoted title comes off.
  it('keeps an address with a space and no quoted title whole', () => {
    expect(routeMarkdownHref('docs/my file.md')).toEqual({ kind: 'file', pathText: 'docs/my file.md' })
    expect(routeMarkdownHref('https://x.dev/a"b"')).toEqual({ kind: 'web', url: 'https://x.dev/a"b"' })
    expect(parseInline('[a](docs/my file.md)')).toEqual([{ kind: 'link', text: 'a', url: 'docs/my file.md' }])
  })

  // Pinned choice: CommonMark also allows a title in parentheses, but a file
  // an agent links often has one in its name ("Screenshot (2).png"), and
  // taking it off would open another file. So a (title) stays in the address.
  it('keeps a parenthesised group after a space in the address', () => {
    expect(routeMarkdownHref('shots/Screenshot (2).png')).toEqual({ kind: 'file', pathText: 'shots/Screenshot (2).png' })
    expect(routeMarkdownHref('https://x.dev (T)')).toEqual({ kind: 'web', url: 'https://x.dev (T)' })
  })

  it('reads an empty address and one that is only a quoted string as they are', () => {
    expect(routeMarkdownHref('')).toEqual({ kind: 'none' })
    expect(routeMarkdownHref('"T"')).toEqual({ kind: 'file', pathText: '"T"' })
    expect(markdownLinkDestination('')).toBe('')
    expect(markdownLinkDestination('"')).toBe('"')
    expect(markdownLinkDestination('a ""')).toBe('a')
  })

  // The rule the Copy has always used, as the regex it was written as.
  it('takes off exactly the title the Copy\'s regex took off', () => {
    const copyRule = (href: string) => href.trim().replace(/\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/, '')
    const parts = [' ', '"', "'", '\\', 'a', '\t', '"x"', " 'y'"]
    let seed = 7
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed
    }
    for (let index = 0; index < 20_000; index++) {
      const href = Array.from({ length: 1 + (random() % 12) }, () => parts[random() % parts.length]).join('')
      expect(markdownLinkDestination(href), JSON.stringify(href)).toBe(copyRule(href))
    }
  })

  it.each([
    { name: 'a long run of spaces', href: `a${' '.repeat(100_000)}b"` },
    { name: 'a long run of escaped quotes', href: `a "${'\\"'.repeat(50_000)}` },
    { name: 'many quoted words', href: 'a "x"'.repeat(20_000) }
  ])('reads an address with $name within the deadline', ({ href }) => {
    // The link's own reading: the Copy of its words and address, the tap,
    // and the PR comment's token. (A whole reply of this shape also goes
    // through the HTML pass and marked, which are slower on it by themselves.)
    const context = { copy: markdownInlinePlainText, route: routeMarkdownHref, parse: parseInline, href, text: `[a](${href})` }
    expect(typeof runInNewContext('copy(text)', context, { timeout: 500 })).toBe('string')
    expect(runInNewContext('route(href)', context, { timeout: 500 })).toBeTruthy()
    expect(runInNewContext('parse(text)', context, { timeout: 500 })).toHaveLength(1)
  })
})
