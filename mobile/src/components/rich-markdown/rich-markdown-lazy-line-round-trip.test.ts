// @vitest-environment happy-dom
import { marked } from 'marked'
import { describe, expect, it } from 'vitest'
import { openedSurface, savedUntouched } from './rich-markdown-round-trip.test-support'

/** marked's reading of a document, whitespace aside: the editor joins a wrapped line with a space. */
const reading = (source: string) =>
  marked
    .parse(source, { async: false })
    .replace(/\s+/g, ' ')
    .replace(/> </g, '><')
    .trim()

// Review, 2026-09-30: a hard-wrapped item or quote whose next line was not indented, which is how
// git-wrapped READMEs and docs are written, saved with a blank line inserted there. The wrapped
// text left the item or the quote and became a paragraph of its own, cut mid-sentence. CommonMark
// reads such a line (a lazy continuation line) as more of the paragraph above it.
describe('a wrapped line at the margin under an item or a quote', () => {
  it.each([
    ['a bullet', '- first line\nsecond line', '- first line second line'],
    ['a numbered item before the next', '1. first line\nsecond line\n2. b', '1. first line second line\n2. b'],
    ['after an indented wrapped line', '- a\n  lazy\nb', '- a lazy b'],
    ['a nested item', '- a\n  - b\nc', '- a\n  - b c'],
    ['a task', '- [ ] a\nlazy', '- [ ] a lazy'],
    ['a later paragraph of the item', '- a\n\n  b\nc', '- a\n\n  b c'],
    ['an item of one line, at the end with a blank line after', '- a\nlazy\n', '- a lazy'],
    ['a quote', '> first line\nsecond line', '> first line\n> second line'],
    ['a quote of two lines', '> a\n> b\nc', '> a\n> b\n> c'],
    ['a quote inside an item', '- a\n  > q\nlazy', '- a\n  > q\n  > lazy'],
    ['a quote on an item’s marker line', '- > q\nlazy\n- b', '- > q\n  > lazy\n- b'],
    ['a quote inside a quote', '> a\n> > b\nc', '> a\n> > b\n> > c']
  ])('keeps the line in %s', (_name, markdown, saved) => {
    expect(savedUntouched(markdown)).toBe(saved)
    expect(reading(savedUntouched(markdown))).toBe(reading(markdown))
  })

  it('draws the wrapped line inside its item', () => {
    const { editor } = openedSurface('1. first line\nsecond line\n2. b')
    expect(Array.from(editor.querySelectorAll('ol > li')).map((item) => item.textContent)).toEqual([
      'first line second line',
      'b'
    ])
    expect(editor.querySelectorAll(':scope > p')).toHaveLength(0)
  })

  it('keeps a paragraph interrupted by a bullet, and the lines wrapped under it, as marked reads them', () => {
    // docs/mobile-agent-hud.md, lines 155-162, as written: line 156 opens with `+ `, which
    // CommonMark reads as a bullet interrupting the paragraph above it, and the six lines under it
    // are that bullet's, lazily.
    const markdown = [
      'An OSC begins with ESC, and ESC aborts whatever sequence it lands in. `ESC[?`',
      "+ beacon + `2026h` made xterm.js print `2026h` at the caret, and Claude's diff",
      'renderer never repaints an unchanged input row. The reverse splice, a frame',
      'landing inside the beacon, ended the OSC early and printed the rest of its',
      'payload (`used=… win=…`) as text. On a private pty with Claude-shaped frames',
      "and the host's exact `printf`, 1-4 % of beacons landed inside an escape at",
      '5-20 ms of reader lag, `ESC[?` → `2026h` among them. The phone never showed',
      'it: it rejoined the two halves when it took the OSC out.'
    ].join('\n')
    expect(reading(savedUntouched(markdown))).toBe(reading(markdown))
    expect(openedSurface(markdown).editor.querySelector('li')?.textContent).toMatch(
      /^beacon \+ 2026h made .* it: it rejoined the two halves when it took the OSC out\.$/
    )
  })
})

describe('a line at the margin that is no lazy line', () => {
  it.each([
    ['after a blank line', '- a\n\nb', '- a\n\nb'],
    ['after a blank line in a quote', '> a\n>\nb', '> a\n\nb'],
    ['under an empty quote', '>\nlazy', '>\n\nlazy'],
    ['after an item’s fence', '- a\n  ```\n  x\n  ```\nlazy', '- a\n  ```\n  x\n  ```\n\nlazy'],
    ['after a quote’s fence', '> ```\n> x\n> ```\nc', '> ```\n> x\n> ```\n\nc'],
    ['inside a quote’s open fence', '> ```\n> x\nc', '> ```\n> x\n> ```\n\nc'],
    ['after a quote’s indented code', '> a\n>\n>     code\nc', '> a\n>\n>     code\n\nc'],
    ['a heading', '- a\n# h', '- a\n\n# h'],
    ['a heading under a quote', '> a\n# h', '> a\n\n# h'],
    ['a quote', '- a\n> q', '- a\n\n> q'],
    ['a fence', '- a\n```\nx\n```', '- a\n\n```\nx\n```'],
    ['a rule', '- a\n***', '- a\n\n---'],
    ['a sibling item', '- a\n- b', '- a\n- b'],
    ['a list of another kind', '- a\n1. b', '- a\n\n1. b'],
    ['an item after a quote', '> a\n- b', '> a\n\n- b'],
    ['an HTML block', '- a\n<div>\nb', '- a\n\n<div> b']
  ])('ends the item or the quote at %s', (_name, markdown, saved) => {
    expect(savedUntouched(markdown)).toBe(saved)
    expect(reading(savedUntouched(markdown))).toBe(reading(markdown))
  })

  it('ends the item at an empty marker rather than taking it for words', () => {
    // marked reads '- a\n-' as a list of two items, the second empty. The editor has no empty
    // item to hold it; the marker must not become the item's words either.
    expect(savedUntouched('- a\n-')).not.toContain('a -')
  })

  it('ends the item at a table rather than taking its rows for words', () => {
    expect(savedUntouched('- a\n| x | y |\n| - | - |')).toBe('- a\n\n| x | y |\n| - | - |')
  })
})
