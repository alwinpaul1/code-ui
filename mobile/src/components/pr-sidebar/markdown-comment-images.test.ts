import { describe, expect, it } from 'vitest'
import { parseInline } from './markdown-blocks'

// Review, 2026-09-30: a PR comment's screenshot, '![shot](https://x.dev/i.png)',
// drew a stray '!' before a link reading "shot", and a README badge,
// '[![CI](badge.svg)](https://ci)', drew a link to the badge image labelled
// "![CI" with '](https://ci)' after it. The PR reader now reads images, a
// label that holds one, and backslash escapes, as the chat does. The drawing
// is pinned in CommentMarkdown.images.test.tsx.

describe('an image in a PR comment', () => {
  it('reads an image as a link labelled with its alt text, with no stray "!"', () => {
    expect(parseInline('![shot](https://x.dev/i.png)')).toEqual([
      { kind: 'link', text: 'shot', url: 'https://x.dev/i.png' }
    ])
    expect(parseInline('See ![the shot](https://x.dev/i.png) here')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: 'the shot', url: 'https://x.dev/i.png' },
      { kind: 'text', text: ' here' }
    ])
  })

  it('labels an image with no alt text "image"', () => {
    expect(parseInline('![](https://x.dev/i.png)')).toEqual([{ kind: 'link', text: 'image', url: 'https://x.dev/i.png' }])
  })

  it('reads a badge as one link to its target, the image inside its words', () => {
    expect(parseInline('[![CI](https://img.shields.io/b.svg)](https://ci.dev)')).toEqual([
      { kind: 'link', text: '![CI](https://img.shields.io/b.svg)', url: 'https://ci.dev' }
    ])
  })

  it('reads an image inside a link\'s words as its alt text, never a link of its own', () => {
    expect(parseInline('![CI](https://img.shields.io/b.svg)', true)).toEqual([{ kind: 'text', text: 'CI' }])
    expect(parseInline('![](b.svg) build', true)).toEqual([{ kind: 'text', text: 'image' }, { kind: 'text', text: ' build' }])
  })

  // Pinned: a backslash before the '!' makes it text, as CommonMark and
  // GitHub read it, so what follows is a plain link.
  it('reads an escaped "!" before a link as a "!" and the link', () => {
    expect(parseInline('\\![x](https://y.dev)')).toEqual([
      { kind: 'text', text: '!' },
      { kind: 'link', text: 'x', url: 'https://y.dev' }
    ])
  })

  // The escapes that come with reading images: a text run drops an escape's
  // backslash, and an escaped mark is no emphasis. Code keeps its backslashes.
  it('reads backslash escapes in text runs, and leaves code and a Windows path alone', () => {
    expect(parseInline('\\*not italic\\*')).toEqual([{ kind: 'text', text: '*not italic*' }])
    expect(parseInline('`a\\*b`')).toEqual([{ kind: 'code', text: 'a\\*b' }])
    expect(parseInline('C:\\Users\\x')).toEqual([{ kind: 'text', text: 'C:\\Users\\x' }])
  })

  it('keeps a lone "!" and a "!" before plain brackets as written', () => {
    expect(parseInline('!')).toEqual([{ kind: 'text', text: '!' }])
    expect(parseInline('wow! [not a link]')).toEqual([{ kind: 'text', text: 'wow! [not a link]' }])
    expect(parseInline('')).toEqual([])
  })
})
