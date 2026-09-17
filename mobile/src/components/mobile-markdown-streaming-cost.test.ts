import { readFileSync } from 'node:fs'
import { fastestRunMs } from './markdown-parse-cost'
import { describe, expect, it } from 'vitest'
import { parseMobileMarkdown } from './mobile-markdown-parser'

// The chat view re-parses the whole message on every streamed tick, up to ~20
// times a second, and this fork already spends its frame budget on the
// terminal. A conforming parser is heavier than the line loop it replaced, so
// pin the cost against the longest real document in the repository rather than
// discover it as a dropped frame on the phone.
const CLAUDE_MD = new URL('../../../CLAUDE.md', import.meta.url)

describe('the cost of re-parsing a streaming message', () => {
  // Every measurement below feeds a DISTINCT string. The parser caches by source
  // text, and a streamed message is a fresh string every tick, so a repeat of one
  // document would time the cache and report a parser cost of nearly zero however
  // slow the parser got.
  it('parses this repository’s CLAUDE.md well inside a frame', () => {
    const document = readFileSync(CLAUDE_MD, 'utf8')
    expect(document.length).toBeGreaterThan(5_000)
    // Warm the lexer so the first-call cost is not measured as the steady one.
    parseMobileMarkdown(`${document}\n\nwarm`)
    let tick = 0
    const perParse = fastestRunMs(() => parseMobileMarkdown(`${document}\n\ntick ${(tick += 1)}`))
    expect(perParse).toBeLessThan(16)
  })

  it('parses a message four times that length inside two frames', () => {
    const document = readFileSync(CLAUDE_MD, 'utf8').repeat(4)
    parseMobileMarkdown(`${document}\n\nwarm`)
    let tick = 0
    expect(
      fastestRunMs(() => parseMobileMarkdown(`${document}\n\nmeasured${(tick += 1)}`))
    ).toBeLessThan(32)
  })
})
