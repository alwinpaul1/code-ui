import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { createMarkdownInlineMatcher, markdownInlineTokenPattern } from './markdown-inline-matcher'
import { markdownInlinePlainText, markdownPlainText } from './markdown-plain-text'
import { parseInline } from './pr-sidebar/markdown-blocks'

// Review, 2026-09-30: agent replies bold a glob or a command in backticks,
// `**Edit `*.ts` files**`, and a star INSIDE the code span ended the bold
// early, so the phone drew and copied `**Edit *.ts files**`, both star pairs
// literal. Code spans bind before emphasis (CommonMark 6.1), so a star inside
// backticks is never a delimiter. The drawing is pinned in
// MobileMarkdown.emphasis-around-code-span.test.tsx.

function chatTokens(text: string): string[] {
  const matcher = createMarkdownInlineMatcher(text, markdownInlineTokenPattern(), true, true)
  const found: string[] = []
  let match
  while ((match = matcher.exec())) {
    found.push(match[0])
  }
  return found
}

describe('emphasis around a code span that holds a star', () => {
  it('copies a bold phrase around a glob without any stars of the bold', () => {
    expect(markdownInlinePlainText('**Edit `*.ts` files**')).toBe('Edit *.ts files')
    expect(markdownInlinePlainText('**`src/**/*.ts`**')).toBe('src/**/*.ts')
    expect(markdownInlinePlainText('*use `x*y` now*')).toBe('use x*y now')
    expect(markdownInlinePlainText('__glob `*_*` here__')).toBe('glob *_* here')
    expect(markdownInlinePlainText('~~drop `a~~b` too~~')).toBe('drop a~~b too')
  })

  it('copies a list item that bolds a glob as the item, the glob intact', () => {
    expect(markdownPlainText('- **`**/*.md`**: docs')).toBe('• **/*.md: docs')
    expect(markdownPlainText('1. Run **`rm *.log`** first')).toBe('1. Run rm *.log first')
  })

  it('reads the bold as one token around the whole code span', () => {
    expect(chatTokens('**Edit `*.ts` files**')).toEqual(['**Edit `*.ts` files**'])
    expect(chatTokens('*use `x*y` now*')).toEqual(['*use `x*y` now*'])
  })

  it('reads the same bold in a PR comment', () => {
    expect(parseInline('**Edit `*.ts` files**')).toEqual([{ kind: 'bold', text: 'Edit `*.ts` files' }])
    expect(parseInline('*use `x*y` now*')).toEqual([{ kind: 'italic', text: 'use `x*y` now' }])
  })

  // Guards: what already read right must still.
  it('keeps an unmatched backtick literal, the stars around it still emphasis', () => {
    expect(markdownInlinePlainText('**a ` b**')).toBe('a ` b')
    expect(markdownInlinePlainText('a ` *b*')).toBe('a ` b')
  })

  it('copies a code span on its own unchanged', () => {
    expect(markdownInlinePlainText('`*.ts`')).toBe('*.ts')
    expect(chatTokens('`**/*.md`')).toEqual(['`**/*.md`'])
  })

  it('still closes an emphasis in prose after a code span', () => {
    expect(markdownInlinePlainText('**a** `*` and *b*')).toBe('a * and b')
    expect(chatTokens('*a* `x` *b*')).toEqual(['*a*', '`x`', '*b*'])
  })

  it('does not open emphasis from a star inside one code span to a star inside another', () => {
    expect(markdownInlinePlainText('`a*` b `*c`')).toBe('a* b *c')
    expect(chatTokens('`a*` b `*c`')).toEqual(['`a*`', '`*c`'])
  })

  it('still reads an escape beside a code span', () => {
    expect(markdownInlinePlainText('\\*not `*` bold\\*')).toBe('*not * bold*')
    expect(markdownInlinePlainText('**\\* `*.ts`**')).toBe('* *.ts')
  })

  it('reads the emphasis after a link whose words hold a lone backtick', () => {
    // The link's `\`` pairs with the one at the end of the line when read
    // from the start; once the link has taken its own, the bold is prose.
    expect(markdownInlinePlainText('[a`b](x) **bold** `c')).toBe('a`b bold `c')
    // And a span after that link is masked as the finder then reads it.
    expect(markdownInlinePlainText('[a`b](x) **Edit `*.ts` files** `c')).toBe('a`b Edit *.ts files `c')
  })

  it('reads nothing from empty text and one character', () => {
    expect(chatTokens('')).toEqual([])
    expect(chatTokens('`')).toEqual([])
    expect(chatTokens('*')).toEqual([])
  })

  it.each([
    { name: 'backticks and stars in turn', text: '`*'.repeat(40_000) },
    { name: 'bold around a starred span, never closed', text: '**`*` '.repeat(20_000) },
    { name: 'spans of stars', text: '`***` '.repeat(20_000) },
    { name: 'links with a lone backtick before bold', text: '[a`](x) **b** '.repeat(8_000) },
    { name: 'an unmatched run of every length among stars', text: Array.from({ length: 400 }, (_, k) => `*${'`'.repeat(k + 1)} x *`).join('') }
  ])('reads $name within the parser deadline', ({ text }) => {
    const copy = runInNewContext('plain(text)', { plain: markdownInlinePlainText, text }, { timeout: 500 })
    expect(typeof copy).toBe('string')
    const tokens = runInNewContext('parse(text)', { parse: parseInline, text }, { timeout: 500 })
    expect(Array.isArray(tokens)).toBe(true)
  })
})
