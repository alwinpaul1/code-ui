import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { createMarkdownInlineMatcher } from './markdown-inline-matcher'
import { isIntrawordUnderscoreToken } from './markdown-inline-token-rules'
import { parseInline } from './pr-sidebar/markdown-blocks'

const ORIGINAL_CHAT =
  /(!\[[^\]]*\]\([^)]+\)|`[^`]+`|~~[^~]+~~|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<]+)/g
const CHAT_OTHER =
  /(`[^`]+`|~~[^~]+~~|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|https?:\/\/[^\s<]+)/g
const ORIGINAL_REVIEW =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]+\]\([^)]+\))/g
const REVIEW_OTHER = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)/g

/** The link rules written the slow, obvious way, to hold the linear finder
 *  to: every opener in turn; its label to the first `]` after it, past any
 *  whole image inside it in a chat reply; its address to the `)` that
 *  balances it. */
function naiveDestinationEnd(text: string, start: number): number {
  let depth = 0
  for (let index = start; index < text.length; index++) {
    if (text[index] === '(') {
      depth++
    } else if (text[index] === ')') {
      if (depth === 0) {
        return index
      }
      depth--
    }
  }
  return -1
}

function naiveLabelEnd(text: string, from: number, chat: boolean): number {
  for (let index = from; index < text.length; index++) {
    if (text[index] === ']') {
      return index
    }
    if (chat && text[index] === '!' && text[index + 1] === '[') {
      const image = naiveLinkEnd(text, index + 1, chat, true)
      if (image !== -1) {
        index = image - 1
      }
    }
  }
  return -1
}

function naiveLinkEnd(text: string, open: number, chat: boolean, image: boolean): number {
  const labelEnd = naiveLabelEnd(text, open + 1, chat)
  if (labelEnd === -1 || text[labelEnd + 1] !== '(' || (!image && labelEnd === open + 1)) {
    return -1
  }
  const destinationEnd = naiveDestinationEnd(text, labelEnd + 2)
  return destinationEnd > labelEnd + 2 ? destinationEnd + 1 : -1
}

function naiveFindLink(text: string, from: number, chat: boolean) {
  for (let open = text.indexOf('[', from); open !== -1; open = text.indexOf('[', open + 1)) {
    const image = chat && open > from && text[open - 1] === '!'
    const end = naiveLinkEnd(text, open, chat, image)
    if (end !== -1) {
      const index = image ? open - 1 : open
      return { 0: text.slice(index, end), index, end }
    }
  }
  return null
}

type Reference = 'matcher' | 'original' | 'naive'

function tokens(text: string, chat: boolean, reference: Reference = 'matcher') {
  const pattern = new RegExp(chat ? ORIGINAL_CHAT : ORIGINAL_REVIEW)
  const other = new RegExp(chat ? CHAT_OTHER : REVIEW_OTHER)
  const naive = {
    lastIndex: 0,
    exec() {
      other.lastIndex = naive.lastIndex
      const found = other.exec(text)
      const link = naiveFindLink(text, naive.lastIndex, chat)
      const match =
        link && (!found || link.index < found.index)
          ? link
          : found && { 0: found[0], index: found.index, end: other.lastIndex }
      if (match) {
        naive.lastIndex = match.end
      }
      return match
    }
  }
  const matcher =
    reference === 'original'
      ? {
          get lastIndex() {
            return pattern.lastIndex
          },
          set lastIndex(value) {
            pattern.lastIndex = value
          },
          exec: () => pattern.exec(text)
        }
      : reference === 'naive'
        ? naive
        : createMarkdownInlineMatcher(text, other, chat)
  const result: Array<{ text: string; index: number; end: number }> = []
  let match
  while ((match = matcher.exec())) {
    if (chat && isIntrawordUnderscoreToken(text, match.index, match[0])) {
      matcher.lastIndex = match.index + 1
      continue
    }
    result.push({ text: match[0], index: match.index, end: matcher.lastIndex })
  }
  return result
}

function randomTexts(fragments: readonly string[], count: number): string[] {
  let seed = 12345
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed
  }
  return Array.from({ length: count }, () =>
    Array.from({ length: 1 + (random() % 40) }, () => fragments[random() % fragments.length]).join('')
  )
}

const FRAGMENTS = [
  '[',
  ']',
  '(',
  ')',
  '!',
  'a',
  ' ',
  '*',
  '**',
  '_',
  '__',
  '`',
  '~',
  '\n',
  '[a](b)',
  '![](x)',
  'https://x.y',
  '[bad]',
  'foo_bar',
  '[[nested](url)'
]

describe('mobile inline link scanning', () => {
  // Links now balance the parentheses in an address, and a chat label may
  // hold a whole image (review, 2026-09-30), so the matcher is held to those
  // rules written out naively rather than to the single regex it replaced.
  it.each([false, true])('finds the tokens the obvious link rules find (chat=%s)', (chat) => {
    const fragments = [...FRAGMENTS, '(b(c))', '![a](b)', '[![a](b)](c)', '](', '![']
    for (const text of randomTexts(fragments, 5000)) {
      expect(tokens(text, chat), text).toEqual(tokens(text, chat, 'naive'))
    }
  })

  // Where no address holds a parenthesis, the PR renderer still reads every
  // token as the single regex before the matcher did.
  it('preserves the original token order for the PR renderer where no address holds a parenthesis', () => {
    for (const text of randomTexts(FRAGMENTS.filter((fragment) => fragment !== '('), 5000)) {
      expect(tokens(text, false), text).toEqual(tokens(text, false, 'original'))
    }
  })

  it('preserves the original token order for a chat reply that holds no brackets in a label or address', () => {
    const plain = FRAGMENTS.filter((fragment) => !/[[\]()]/.test(fragment) || fragment === '[a](b)')
    for (const text of randomTexts(plain, 5000)) {
      expect(tokens(text, true), text).toEqual(tokens(text, true, 'original'))
    }
  })

  it.each([
    { name: 'unmatched labels', text: '['.repeat(60_000) },
    { name: 'unmatched destinations', text: '[a]('.repeat(12_000) }
  ])('keeps $name literal within the parser deadline', ({ text }) => {
    const result = runInNewContext('parse(text)', { parse: parseInline, text }, { timeout: 250 })
    expect(result).toEqual([{ kind: 'text', text }])
  })

  // A balanced address and a label that holds an image are both found ahead
  // of time, in one pass each, so a long reply full of openers stays linear.
  it.each([
    { name: 'unmatched labels', text: '['.repeat(60_000) },
    { name: 'unmatched destinations', text: '[a]('.repeat(12_000) },
    { name: 'addresses whose parentheses never balance', text: '[a]((b)'.repeat(10_000) },
    { name: 'an address opened by every link', text: `${'[a]('.repeat(10_000)}${')'.repeat(10_000)}` },
    { name: 'badges that never close', text: '[![a](b)'.repeat(10_000) },
    { name: 'image openers with no label end', text: '[!['.repeat(20_000) },
    { name: 'labels that each hold an image and end nowhere', text: '[![a](b) '.repeat(10_000) },
    { name: 'parentheses around every link', text: '(((['.repeat(10_000) + '](x'.repeat(10_000) }
  ])('reads $name in a chat reply within the parser deadline', ({ text }) => {
    const count = runInNewContext(
      'let n = 0; const m = create(text, pattern(), true, true); while (m.exec()) n++; n',
      { create: createMarkdownInlineMatcher, pattern: () => new RegExp(CHAT_OTHER), text },
      { timeout: 250 }
    )
    expect(typeof count).toBe('number')
  })

  // Review, 2026-09-30: a destination ended at its first `)`, so the token of
  // a Wikipedia link stopped inside its address.
  it.each([false, true])('ends a destination at the parenthesis that balances it (chat=%s)', (chat) => {
    const text = '[w](https://en.wikipedia.org/wiki/Foo_(bar)) ok'
    expect(tokens(text, chat)[0]).toEqual({
      text: '[w](https://en.wikipedia.org/wiki/Foo_(bar))',
      index: 0,
      end: text.length - 3
    })
  })

  it('reads a badge as one link to its target, the image inside its words', () => {
    const text = '[![CI](https://img.shields.io/b.svg)](https://github.com/x/y)'
    const matcher = createMarkdownInlineMatcher(text, new RegExp(CHAT_OTHER), true)
    expect(matcher.exec()).toEqual({
      0: text,
      index: 0,
      end: text.length,
      link: { image: false, label: '![CI](https://img.shields.io/b.svg)', href: 'https://github.com/x/y' }
    })
    expect(matcher.exec()).toBeNull()
  })

  it('does not repeatedly search the suffix for absent non-link tokens', () => {
    const text = '[a](b)'.repeat(10_000)
    const pattern = new RegExp(REVIEW_OTHER)
    const originalExec = pattern.exec.bind(pattern)
    let calls = 0
    pattern.exec = (value) => {
      calls++
      return originalExec(value)
    }
    const matcher = createMarkdownInlineMatcher(text, pattern)
    let count = 0
    while (matcher.exec()) {
      count++
    }
    expect(count).toBe(10_000)
    expect(calls).toBe(1)
  })
})
