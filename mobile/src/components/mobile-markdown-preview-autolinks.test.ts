import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { normalizeMobileMarkdownPreviewHtml } from './mobile-markdown-preview-html'

// Found in the 2026-09-30 sweep of angle-bracket addresses: the HTML pass took
// `<a@b.c>` for an `<a>` tag and dropped it, and drew `<img@x.dev>` as the
// word "image". An autolink is no tag (CommonMark reads it first), so the pass
// now leaves it for the inline pass, which draws it as a link. The screen and
// the Copy are pinned in MobileMarkdown.link-shapes.test.ts and
// markdown-plain-text.test.ts.

const normalize = (text: string) => normalizeMobileMarkdownPreviewHtml(text)

describe('the autolinks the HTML pass leaves as written', () => {
  it('leaves an email, web or mailto address in angle brackets alone, and still reads the tags beside it', () => {
    expect(normalize('<a@b.c> <img@x.dev> <b>x</b>')).toBe('<a@b.c> <img@x.dev> **x**')
    expect(normalize('<https://x.dev/a> <mailto:a@b.c>')).toBe('<https://x.dev/a> <mailto:a@b.c>')
  })

  it('still reads a tag that is no such autolink as a tag, a namespaced one too', () => {
    expect(normalize('<a href="https://x.dev">docs</a>')).toBe('[docs](https://x.dev)')
    // A <br> is a hard break, two spaces and a newline (markdown-br-line-breaks.test.ts).
    expect(normalize('<b>x</b><br/>y')).toBe('**x**  \ny')
    expect(normalize('a<svg:path>b')).toBe('ab')
  })

  it('reads the degenerate sizes: an empty pair, no local part, the shortest address', () => {
    expect(normalize('<>')).toBe('<>')
    expect(normalize('<@b.c>')).toBe('<@b.c>')
    expect(normalize('<a@b>')).toBe('<a@b>')
  })

  it.each([
    ['an opener before every letter', '<a'.repeat(50_000)],
    ['one opener before a long word', `<${'a'.repeat(100_000)}`],
    ['an at sign after every letter', `<${'a@'.repeat(50_000)}`],
    ['a scheme after every opener', '<ab:'.repeat(30_000)]
  ])('reads %s inside the deadline', (_name, text) => {
    const result = runInNewContext('normalize(text)', { normalize, text }, { timeout: 250 })
    expect(typeof result).toBe('string')
  })
})
