import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdownBlocks } from './markdown-blocks'

// Review, 2026-09-30: bot and review comments write angle brackets as
// entities, and a PR comment drew them as written: 'Use Vec&lt;T&gt; &amp;
// R&amp;D' read exactly that. GitHub, and the phone's own chat reader, draw
// the characters. The drawing is pinned in CommentMarkdown.entities.test.tsx.

describe('HTML entities in a PR comment', () => {
  it('draws the characters named entities stand for', () => {
    expect(parseInline('Use Vec&lt;T&gt; &amp; R&amp;D')).toEqual([{ kind: 'text', text: 'Use Vec<T> & R&D' }])
    expect(parseInline('&quot;a&quot; &#39;b&#39; c&nbsp;d')).toEqual([{ kind: 'text', text: '"a" \'b\' c d' }])
    expect(parseInline('&LT;T&GT;')).toEqual([{ kind: 'text', text: '<T>' }])
  })

  it('draws the characters numeric entities stand for', () => {
    expect(parseInline('&#60;T&#62; &#x3C;U&#x3E; &#X3c;')).toEqual([{ kind: 'text', text: '<T> <U> <' }])
    expect(parseInline('&#128512;')).toEqual([{ kind: 'text', text: '😀' }])
  })

  it('decodes an entity once, never twice', () => {
    expect(parseInline('&amp;lt;')).toEqual([{ kind: 'text', text: '&lt;' }])
    expect(parseInline('&amp;#60;')).toEqual([{ kind: 'text', text: '&#60;' }])
    expect(parseInline('&amp;amp;')).toEqual([{ kind: 'text', text: '&amp;' }])
  })

  it('keeps an entity in a code span as written', () => {
    expect(parseInline('`Vec&lt;T&gt;` and &lt;T&gt;')).toEqual([
      { kind: 'code', text: 'Vec&lt;T&gt;' },
      { kind: 'text', text: ' and <T>' }
    ])
  })

  it('keeps a bare "&", an unknown name and a number that is no character as written', () => {
    expect(parseInline('R & D &foo; &#; &#xZZ; &amp')).toEqual([{ kind: 'text', text: 'R & D &foo; &#; &#xZZ; &amp' }])
    expect(parseInline('&#1114112; &#55296; &#0;')).toEqual([{ kind: 'text', text: '&#1114112; &#55296; &#0;' }])
    expect(parseInline('&')).toEqual([{ kind: 'text', text: '&' }])
  })

  it('draws a decoded mark as text, never as emphasis or a tag', () => {
    expect(parseInline('&#42;a&#42;')).toEqual([{ kind: 'text', text: '*a*' }])
    expect(parseInline('&lt;b&gt;x&lt;/b&gt;')).toEqual([{ kind: 'text', text: '<b>x</b>' }])
  })

  it('keeps an escaped "&" and what follows it as written', () => {
    expect(parseInline('\\&amp; and \\\\&amp;')).toEqual([{ kind: 'text', text: '&amp; and \\&' }])
  })

  it('decodes a link\'s words, inside emphasis, and in a table cell', () => {
    const [link] = parseInline('[a &amp; b](https://x.dev)')
    expect(link).toEqual({ kind: 'link', text: 'a &amp; b', url: 'https://x.dev' })
    expect(parseInline('a &amp; b', true)).toEqual([{ kind: 'text', text: 'a & b' }])
    expect(parseInline('**&lt;T&gt;**')).toEqual([{ kind: 'bold', text: '&lt;T&gt;' }])
    expect(parseInline('&lt;T&gt;')).toEqual([{ kind: 'text', text: '<T>' }])
  })

  it('decodes a collapsible\'s summary', () => {
    expect(parseMarkdownBlocks('<details><summary>Vec&lt;T&gt; &amp; more</summary>\n\nx\n\n</details>')).toEqual([
      { kind: 'details', summary: 'Vec<T> & more', body: [{ kind: 'paragraph', text: 'x' }] }
    ])
  })
})
