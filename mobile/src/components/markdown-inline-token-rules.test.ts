import { describe, expect, it } from 'vitest'
import {
  isIntrawordUnderscoreToken,
  trimAutolinkTrailingPunctuation
} from './markdown-inline-token-rules'

describe('isIntrawordUnderscoreToken', () => {
  it('treats letters of every script as word characters, not just ASCII', () => {
    // `\w` is ASCII-only, so `你好_强调_世界` and `café_crème` read as emphasis and the rich editor
    // saved them back with `*` (review of f7117a1c, 2026-09-23).
    expect(isIntrawordUnderscoreToken('你好_强调_世界', 2, '_强调_')).toBe(true)
    expect(isIntrawordUnderscoreToken('café_crème_brûlée', 4, '_crème_')).toBe(true)
    expect(isIntrawordUnderscoreToken('नमस्ते_दुनिया_ठीक', 6, '_दुनिया_')).toBe(true)
    expect(isIntrawordUnderscoreToken('say _强调_ now', 4, '_强调_')).toBe(false)
  })

  it('rejects snake_case emphasis spans', () => {
    const text = 'src/foo_bar.ts and src/baz_qux.ts'
    const index = text.indexOf('_')
    const token = text.slice(index, text.lastIndexOf('_') + 1)
    expect(isIntrawordUnderscoreToken(text, index, token)).toBe(true)
  })

  it('keeps standalone emphasis', () => {
    expect(isIntrawordUnderscoreToken('say _hello_ now', 4, '_hello_')).toBe(false)
    expect(isIntrawordUnderscoreToken('_hello_.', 0, '_hello_')).toBe(false)
  })

  it('rejects emphasis closed against a following word', () => {
    expect(isIntrawordUnderscoreToken('_foo_s bar', 0, '_foo_')).toBe(true)
  })

  it('rejects dunder emphasis inside a path', () => {
    expect(isIntrawordUnderscoreToken('src/__init__.py', 4, '__init__')).toBe(true)
    expect(isIntrawordUnderscoreToken(String.raw`src\__init__.py`, 4, '__init__')).toBe(true)
  })

  it('ignores non-underscore tokens', () => {
    expect(isIntrawordUnderscoreToken('a*b*c', 1, '*b*')).toBe(false)
  })
})

describe('trimAutolinkTrailingPunctuation', () => {
  it('splits sentence punctuation off the URL', () => {
    expect(trimAutolinkTrailingPunctuation('https://x.com/a.')).toEqual({
      url: 'https://x.com/a',
      trailing: '.'
    })
    expect(trimAutolinkTrailingPunctuation('https://x.com/a,')).toEqual({
      url: 'https://x.com/a',
      trailing: ','
    })
    expect(trimAutolinkTrailingPunctuation('https://x.com/a?!')).toEqual({
      url: 'https://x.com/a',
      trailing: '?!'
    })
  })

  it('keeps balanced parens and strips unbalanced ones', () => {
    expect(trimAutolinkTrailingPunctuation('https://x.com/a_(b)')).toEqual({
      url: 'https://x.com/a_(b)',
      trailing: ''
    })
    expect(trimAutolinkTrailingPunctuation('https://x.com/a).')).toEqual({
      url: 'https://x.com/a',
      trailing: ').'
    })
  })

  it('handles long unmatched closing-parenthesis tails', () => {
    const url = 'https://x.com/a_(b)'
    const trailing = ')'.repeat(4096)
    expect(trimAutolinkTrailingPunctuation(`${url}${trailing}`)).toEqual({ url, trailing })
  })

  it('leaves clean URLs untouched', () => {
    expect(trimAutolinkTrailingPunctuation('https://x.com/a')).toEqual({
      url: 'https://x.com/a',
      trailing: ''
    })
  })
})
