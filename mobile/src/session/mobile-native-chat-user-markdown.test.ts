import { describe, expect, it } from 'vitest'
import { fastestRunMs } from '../components/markdown-parse-cost'
import { markdownDocumentSource, normalizeMobileMarkdownPreviewHtml } from '../components/mobile-markdown-preview-html'
import { parseMobileMarkdown } from '../components/mobile-markdown-parser'
import {
  isSlashCommandPrompt,
  USER_MARKDOWN_MAX_BACKTICKS,
  USER_MARKDOWN_MAX_CHARS,
  USER_MARKDOWN_MAX_EMPHASIS_MARKS,
  userTextDrawsAsMarkdown
} from './mobile-native-chat-user-markdown'

// Which sent prompts are drawn as the Markdown document, and which stay the
// plain bubble line. The Claude app draws every prompt through its Markdown
// composable; here a prompt takes the document only when it holds something
// the document would draw, because a plain prompt is nearly every prompt and
// the document costs a parse and a run of styles in every row of a long chat.
describe('which sent prompts are written in Markdown', () => {
  it.each([
    ['bold', 'Fix **this** first'],
    ['a bold lead-in on its own', '**6. Check memory pressure quickly**'],
    ['a code span', 'run `pnpm test` now'],
    ['a fence with code in it', '```bash\npnpm test\n```'],
    ['a fence with no language', 'Add this:\n\n```\n- one\n```'],
    ['a bullet', '- one'],
    ['a star bullet', '* one\n* two'],
    ['a numbered step', '1. first\n2. second'],
    ['a numbered step with a bracket', '1) first'],
    ['a heading', '# Plan'],
    ['a quote', '> said it'],
    ['strike', 'it was ~~wrong~~ right'],
    ['an emphasis', 'this is *really* it'],
    ['an underscore emphasis', 'this is _really_ it'],
    ['a link', 'see [the spec](https://example.com/spec)'],
    ['a web address', 'try https://example.com/spec'],
    ['a table', '| a | b |\n|---|---|\n| 1 | 2 |'],
    ['a rule', 'above\n\n---\n\nbelow']
  ])('draws %s as Markdown', (_name, text) => {
    expect(userTextDrawsAsMarkdown(text)).toBe(true)
  })

  it.each([
    ['one short line', 'ship it'],
    ['a sentence with a stray star', 'what is 3 * 4 * 5, and 2 - 1?'],
    ['a snake_case word', 'rename snake_case_name and file_name.ts'],
    ['a number and a dot', 'I have 1. question'],
    ['a dash in the middle', 'a - b'],
    ['an email address', 'mail me at me@example.com'],
    ['words over several lines', 'first line\nsecond line\n\nthird paragraph']
  ])('keeps %s the plain bubble line', (_name, text) => {
    expect(userTextDrawsAsMarkdown(text)).toBe(false)
  })

  it.each([
    ['nothing', ''],
    ['only spaces', '   '],
    ['only newlines', '\n\n\n'],
    ['a lone fence', '```'],
    ['a fence with a language and no code', '```ts'],
    ['an empty fence', '```\n```'],
    ['an empty bullet', '- '],
    ['an empty number', '1.'],
    ['a bare heading mark', '#'],
    ['a bare quote mark', '> '],
    ['two stars', '**']
  ])('keeps %s as it was typed: a bubble of nothing is worse than the characters', (_name, text) => {
    expect(userTextDrawsAsMarkdown(text)).toBe(false)
  })

  it.each([
    ['one backtick', '`'],
    ['one code span', '`x`'],
    ['one bullet', '- a'],
    ['one heading', '# t'],
    ['one bold word', '**a**']
  ])('draws %s, the smallest Markdown there is, as Markdown', (_name, text) => {
    expect(userTextDrawsAsMarkdown(text)).toBe(true)
  })

  describe('a slash command', () => {
    it.each([
      '/code-review the diff with `pnpm test` and **care**',
      '/loop check job 2888',
      '/plugin:cmd',
      '/effort',
      '  /effort `high`',
      '\n/model **opus**'
    ])('stays plain: %j', (text) => {
      expect(isSlashCommandPrompt(text)).toBe(true)
      expect(userTextDrawsAsMarkdown(text)).toBe(false)
    })

    it.each([
      '/Users/me/app/README.md has **no** install step',
      '/ **bold**',
      '//comment `x`',
      'use /loop **now**'
    ])('is not a command: %j', (text) => {
      expect(isSlashCommandPrompt(text)).toBe(false)
      expect(userTextDrawsAsMarkdown(text)).toBe(true)
    })
  })

  describe('a long paste', () => {
    it('is Markdown up to the cap and plain one character over it', () => {
      const head = '**note** '
      expect(userTextDrawsAsMarkdown(head + 'x'.repeat(USER_MARKDOWN_MAX_CHARS - head.length))).toBe(true)
      expect(userTextDrawsAsMarkdown(head + 'x'.repeat(USER_MARKDOWN_MAX_CHARS - head.length + 1))).toBe(false)
    })

    it('is checked cheaply when it is far past the cap, and when it is plain', () => {
      const long = '**note** ' + 'word '.repeat(200_000)
      const plain = 'plain words '.repeat(200_000)
      expect(fastestRunMs(() => userTextDrawsAsMarkdown(long))).toBeLessThan(5)
      expect(userTextDrawsAsMarkdown(long)).toBe(false)
      expect(userTextDrawsAsMarkdown(plain)).toBe(false)
      expect(fastestRunMs(() => userTextDrawsAsMarkdown(plain))).toBeLessThan(5)
    })

    it('stays plain past the emphasis-mark budget and Markdown at it', () => {
      expect(USER_MARKDOWN_MAX_EMPHASIS_MARKS).toBe(600)
      expect(userTextDrawsAsMarkdown('*a* '.repeat(USER_MARKDOWN_MAX_EMPHASIS_MARKS / 2))).toBe(true)
      expect(userTextDrawsAsMarkdown('*a* '.repeat(USER_MARKDOWN_MAX_EMPHASIS_MARKS / 2 + 1))).toBe(false)
    })

    it('stays plain past the backtick budget and Markdown at it', () => {
      expect(userTextDrawsAsMarkdown('`a` '.repeat(USER_MARKDOWN_MAX_BACKTICKS / 2))).toBe(true)
      expect(userTextDrawsAsMarkdown('`a` '.repeat(USER_MARKDOWN_MAX_BACKTICKS / 2 + 1))).toBe(false)
    })

    // 3000 stray `**a ` in 12,000 characters took the parser 1.5 s on a
    // laptop: it pairs every unmatched opener against the rest. The cap on
    // length alone let that through; a paste of a log can look like it.
    it.each([
      ['stray bold openers', '**a '.repeat(3000)],
      ['stray emphasis openers', '*a '.repeat(4000)],
      ['stray underscore openers', ' __a'.repeat(2400)],
      ['mixed openers', '*a **b _c '.repeat(1200)],
      ['stacked stars', '*'.repeat(11_999)]
    ])('answers a paste of %s in a frame or two, not a second', (_name, text) => {
      expect(fastestRunMs(() => userTextDrawsAsMarkdown(text), 3)).toBeLessThan(100)
      expect(userTextDrawsAsMarkdown(text)).toBe(false)
    })
  })

  it('hands the document its parse: the document reads the same source with the same line-break rule', () => {
    const text = '**Step one**\n\n- `a`\n- `b`'
    expect(userTextDrawsAsMarkdown(text)).toBe(true)
    const source = normalizeMobileMarkdownPreviewHtml(markdownDocumentSource(text))
    expect(parseMobileMarkdown(source, true)).toBe(parseMobileMarkdown(source, true))
  })
})
