import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { normalizeMobileMarkdownPreviewHtml } from './mobile-markdown-preview-html'

// Review, 2026-09-30: the HTML pass protected a code span only as a backtick
// and anything up to the next one on the same line, so the tags in a span
// across a soft line break were rewritten to `**x**` before the screen drew
// the span. It now finds spans the way the screen does, across the lines of
// one paragraph (markdown-code-spans.ts). The Copy and the screen are pinned
// in markdown-plain-text.test.ts and MobileMarkdown.code-protection.test.tsx.

const normalize = (text: string) => normalizeMobileMarkdownPreviewHtml(text)

describe('the code spans the HTML pass leaves as written', () => {
  it('leaves a span across a soft line break whole, and rewrites the tags around it', () => {
    expect(normalize('<b>a</b> `<b>x\ny</b>` <i>b</i>')).toBe('**a** `<b>x\ny</b>` *b*')
  })

  it('reads the degenerate sizes: nothing, one backtick, one empty pair, a lone line', () => {
    expect(normalize('')).toBe('')
    expect(normalize('`')).toBe('`')
    expect(normalize('`` <b>x</b>')).toBe('`` **x**')
    expect(normalize('`<b>x</b>`')).toBe('`<b>x</b>`')
  })

  it('ends the lines a span can cross at a blank line, a heading, a rule, a table row, an item and a new quote', () => {
    expect(normalize('`x\n\n<b>y</b>`')).toBe('`x\n\n**y**`')
    expect(normalize('# `x\n<b>y</b>`')).toBe('# `x\n**y**`')
    expect(normalize('`x\n***\n<b>y</b>`')).toBe('`x\n***\n**y**`')
    expect(normalize('`x\n| <b>y</b>` |')).toBe('`x\n| **y**` |')
    expect(normalize('- `x\n- <b>y</b>`')).toBe('- `x\n- **y**`')
    expect(normalize('`x\n> <b>y</b>`')).toBe('`x\n> **y**`')
    // One quote's lines are one paragraph.
    expect(normalize('> `x\n> <b>y</b>`')).toBe('> `x\n> <b>y</b>`')
  })

  it.each([
    ['many spans in one paragraph', '`a` '.repeat(50_000)],
    ['many spans over line breaks', '`a\nb` '.repeat(30_000)],
    ['a lone backtick on every line', 'a `b\n'.repeat(40_000)],
    ['an unmatched run of every length', Array.from({ length: 400 }, (_, k) => `${'`'.repeat(k + 1)} x `).join('')],
    ['escaped backticks', '\\`a` '.repeat(40_000)]
  ])('reads %s inside the deadline', (_name, text) => {
    const result = runInNewContext('normalize(text)', { normalize, text }, { timeout: 250 })
    expect(typeof result).toBe('string')
  })
})
