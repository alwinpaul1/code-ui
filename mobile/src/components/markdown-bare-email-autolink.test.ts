import { describe, expect, it } from 'vitest'
import { ADDRESS_TOKEN_GROUP, createMarkdownInlineMatcher, markdownInlineTokenPattern } from './markdown-inline-matcher'
import { autolinkParts } from './markdown-inline-token-rules'

// 2026-10-10: the Claude app draws a bare email address in a reply as a link
// (GFM's extended autolink); the phone drew it as text. Which addresses are
// links, and which look like one and are not.
function addresses(text: string): string[] {
  const matcher = createMarkdownInlineMatcher(text, markdownInlineTokenPattern(), true, true)
  const found: string[] = []
  let match
  while ((match = matcher.exec())) {
    if (match.group === ADDRESS_TOKEN_GROUP) {
      found.push(autolinkParts(match[0]).url)
    }
  }
  return found
}

describe('a bare email address in a reply', () => {
  it('is a link that writes to it, the sentence’s full stop left behind', () => {
    expect(addresses('Email: alex.morgan42@example.com')).toEqual(['mailto:alex.morgan42@example.com'])
    expect(addresses('write to a.b+c@mail.example.co.uk.')).toEqual(['mailto:a.b+c@mail.example.co.uk'])
    expect(addresses('(x_y-z@host-name.dev)')).toEqual(['mailto:x_y-z@host-name.dev'])
  })

  it('is not part of a web address, a package version, a scope or a path', () => {
    expect(addresses('https://user@x.dev/a')).toEqual(['https://user@x.dev/a'])
    expect(addresses('ssh://git@github.com/o/r')).toEqual([])
    expect(addresses('upgraded react@18.3.1 and lodash@4.17.21')).toEqual([])
    expect(addresses('npm i @scope/pkg@1.2.3')).toEqual([])
    expect(addresses('see src/icon@2x.png')).toEqual([])
    expect(addresses('ping @alice about it')).toEqual([])
  })

  it('is not a link inside a code span', () => {
    expect(addresses('run `git config user.email a@b.dev`')).toEqual([])
  })

  it('still reads an address in angle brackets as before', () => {
    expect(addresses('<noreply@anthropic.com>')).toEqual(['mailto:noreply@anthropic.com'])
  })
})
