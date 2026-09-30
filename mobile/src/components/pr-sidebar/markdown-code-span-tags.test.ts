import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { createMarkdownInlineMatcher } from '../markdown-inline-matcher'
import { parseInline, parseMarkdownBlocks } from './markdown-blocks'
import { codeSpanRanges, stripHtmlTagsOutsideCode } from './markdown-html-tags'

// Review, 2026-09-30: a PR review comment drew `Array<string>` as the code
// chip "Array", `<div>` as an empty chip ("a `` b" as text), and [`<T>`](url)
// as a link reading two backticks. parseInline stripped HTML tags from the
// whole string before it looked for code spans, so a generic type or an
// element name inside backticks went with them. Code is protected first now,
// as the chat's HTML pass does (protectMarkdownCode).
describe('a PR comment that quotes a tag inside backticks', () => {
  it('keeps a generic type and an element name in their code spans', () => {
    expect(parseInline('use `Array<string>` here')).toEqual([
      { kind: 'text', text: 'use ' },
      { kind: 'code', text: 'Array<string>' },
      { kind: 'text', text: ' here' }
    ])
    expect(parseInline('a `<div>` b')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'code', text: '<div>' },
      { kind: 'text', text: ' b' }
    ])
    expect(parseInline('`` a<b>c `` d')).toEqual([
      { kind: 'code', text: 'a<b>c' },
      { kind: 'text', text: ' d' }
    ])
  })

  it('keeps a code span that is the whole text', () => {
    expect(parseInline('`List<Integer>`')).toEqual([{ kind: 'code', text: 'List<Integer>' }])
  })

  it('keeps the code span in a link label', () => {
    expect(parseInline('see [`<T>`](https://x.y)')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: '`<T>`', url: 'https://x.y' }
    ])
  })

  it('still strips a tag outside the code, on either side of it', () => {
    expect(parseInline('<b>bold</b> and `<i>` then <kbd>K</kbd>')).toEqual([
      { kind: 'text', text: 'bold and ' },
      { kind: 'code', text: '<i>' },
      { kind: 'text', text: ' then K' }
    ])
    expect(parseInline('[<b>docs</b> for `<T>`](https://x.y)')).toEqual([
      { kind: 'link', text: 'docs for `<T>`', url: 'https://x.y' }
    ])
  })

  it('strips tags around a backtick that opens no span', () => {
    expect(parseInline('press ` then <b>go</b>')).toEqual([{ kind: 'text', text: 'press ` then go' }])
    expect(parseInline('``<b>x</b>`')).toEqual([{ kind: 'text', text: '``x`' }])
  })

  it('keeps the code in a <blockquote> body and a <summary>', () => {
    expect(
      parseMarkdownBlocks(
        '<blockquote>use `Array<T>`</blockquote>\n\n<details><summary>Run `ls <dir>`</summary>\n\nx\n</details>'
      )
    ).toEqual([
      { kind: 'quote', text: 'use `Array<T>`' },
      { kind: 'details', summary: 'Run `ls <dir>`', body: [{ kind: 'paragraph', text: 'x' }] }
    ])
  })
})

// codeSpanRanges decides what the tag stripping leaves alone, and the inline
// matcher decides what draws as code. If the two ever disagree, a tag is kept
// in prose or cut out of code, so they are held to one answer.
describe('the code spans the tag stripping protects', () => {
  it('are the ones the inline matcher draws as code', () => {
    const parts = ['`', '``', '```', 'a', ' ', '<b>', '\n', '*']
    let seed = 29
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed
    }
    for (let index = 0; index < 3000; index++) {
      const text = Array.from({ length: 1 + (random() % 24) }, () => parts[random() % parts.length]).join('')
      const matcher = createMarkdownInlineMatcher(text, /(?!)/g, false, true)
      const drawn: [number, number][] = []
      for (let match = matcher.exec(); match; match = matcher.exec()) {
        drawn.push([match.index, match.end])
      }
      expect(codeSpanRanges(text), JSON.stringify(text)).toEqual(drawn)
    }
  })

  it('are none in an empty text or one without a pair', () => {
    expect(codeSpanRanges('')).toEqual([])
    expect(codeSpanRanges('`')).toEqual([])
    expect(codeSpanRanges('`` `')).toEqual([])
    expect(codeSpanRanges('``')).toEqual([])
  })
})

// The tag stripping is held to linear time (markdown-tag-stripping-
// performance.test.ts); cutting it at every code span must keep it there.
// This times the stripping alone. The whole of parseInline over 20,000 code
// spans takes 700 ms or more with no tag in sight: the matcher looks for each
// span from the first backtick run again (findCodeSpan in
// markdown-inline-matcher.ts), which is not this file's to change.
describe('a PR comment with thousands of code spans and tags', () => {
  it.each([
    ['a code span before every unclosed tag', '`x` <a '.repeat(20_000) + '>'],
    ['a tag inside every code span', '`<a>` <b>'.repeat(20_000)],
    ['a backtick run with no partner before every tag', '`` <b>x</b> '.repeat(20_000) + '`'],
    ['backtick runs of every length', Array.from({ length: 400 }, (_, n) => '`'.repeat(n + 1) + ' <a ').join('')]
  ])('strips tags around %s inside the deadline', (_name, text) => {
    const plain = runInNewContext('strip(text)', { strip: stripHtmlTagsOutsideCode, text }, { timeout: 250 })
    expect(typeof plain).toBe('string')
  })

  it('reads a thousand code spans that hold tags in full', () => {
    const text = '`<a>` <b>x</b> '.repeat(1000)
    const tokens = runInNewContext('parse(text)', { parse: parseInline, text }, { timeout: 250 })
    expect(tokens.filter((token: { kind: string }) => token.kind === 'code')).toHaveLength(1000)
    expect(tokens.every((token: { kind: string; text: string }) => token.kind !== 'code' || token.text === '<a>')).toBe(
      true
    )
  })
})
