import { describe, expect, it } from 'vitest'
import { parseInline, type InlineToken } from './markdown-blocks'
import { isAllowedMarkdownLinkUrl } from './markdown-link-scheme'

// Review, 2026-09-30: the PR reader decoded HTML entities in text runs only, so
// a bot-written '[a](https://x.dev/?a=1&amp;b=2)' opened with a literal
// '&amp;' and the query read 'amp;b=2'. CommonMark, and so GitHub, decodes
// entities in a link's destination. The tap is pinned in
// CommentMarkdown.link-entities.test.tsx.

function urlOf(markdown: string): string {
  const link = parseInline(markdown).find((token): token is Extract<InlineToken, { kind: 'link' }> => token.kind === 'link')
  expect(link, markdown).toBeDefined()
  return link!.url
}

describe('HTML entities in a PR comment link\'s address', () => {
  it('opens a link with "&amp;" between its query parameters at the address GitHub opens', () => {
    expect(parseInline('[a](https://x.dev/?a=1&amp;b=2)')).toEqual([
      { kind: 'link', text: 'a', url: 'https://x.dev/?a=1&b=2' }
    ])
  })

  it('decodes numeric references, and an entity only once', () => {
    expect(urlOf('[a](https://x.dev/?q=&#60;T&#x3E;)')).toBe('https://x.dev/?q=<T>')
    expect(urlOf('[a](https://x.dev/?q=&amp;amp;)')).toBe('https://x.dev/?q=&amp;')
    expect(urlOf('[a](https&#58;//x.dev/)')).toBe('https://x.dev/')
  })

  it('decodes an image\'s source and a badge\'s target', () => {
    expect(parseInline('![shot](https://x.dev/i.png?a=1&amp;b=2)')).toEqual([
      { kind: 'link', text: 'shot', url: 'https://x.dev/i.png?a=1&b=2' }
    ])
    expect(urlOf('[![CI](https://ci.dev/b.svg?x=1&amp;y=2)](https://ci.dev/run?a=1&amp;b=2)')).toBe(
      'https://ci.dev/run?a=1&b=2'
    )
  })

  it('takes a title off before it decodes', () => {
    expect(urlOf('[a](https://x.dev/?a=1&amp;b=2 "The docs")')).toBe('https://x.dev/?a=1&b=2')
  })

  it('keeps an address with no entity, a bare "&" and an unknown name as written', () => {
    expect(urlOf('[a](https://x.dev/?a=1&b=2)')).toBe('https://x.dev/?a=1&b=2')
    expect(urlOf('[a](https://x.dev/?a=&foo;&#0;)')).toBe('https://x.dev/?a=&foo;&#0;')
  })

  it('keeps an entity in a link\'s words as written, for the words to decode when drawn', () => {
    expect(parseInline('[a &amp; b](https://x.dev/?a=1&amp;b=2)')).toEqual([
      { kind: 'link', text: 'a &amp; b', url: 'https://x.dev/?a=1&b=2' }
    ])
  })

  // The failure path: a decoded address is still checked before it opens, so
  // an entity cannot carry a scheme past the allowlist.
  it('refuses a scheme spelled with entities exactly as it refuses the scheme written out', () => {
    expect(isAllowedMarkdownLinkUrl(urlOf('[x](javascript:alert(1))'))).toBe(false)
    for (const smuggled of [
      '&#106;avascript:alert(1)',
      '&#x6A;avascript:alert(1)',
      'java&#115;cript:alert(1)',
      'javascript&#58;alert(1)',
      'java&#x09;script:alert(1)',
      'data&#58;text/html,&lt;script&gt;alert(1)&lt;/script&gt;'
    ]) {
      const url = urlOf(`[x](${smuggled})`)
      expect(url, smuggled).not.toContain('&#')
      expect(isAllowedMarkdownLinkUrl(url), smuggled).toBe(false)
    }
  })
})
