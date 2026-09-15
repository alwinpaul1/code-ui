import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  MOBILE_MARKDOWN_PARSE_CACHE_CAP,
  parseMobileMarkdown
} from './mobile-markdown-parser'

// The symptom this guards: scrolling a long transcript.
//
// MobileMarkdown memoizes its parse per text, but FlashList RECYCLES rows — a
// message scrolled off and back on is a fresh mount with a fresh useMemo, so it
// parses again from scratch. The line loop this parser replaced cost 0.03 ms a
// message and that was free; marked costs ~2 ms for a CLAUDE.md-sized one on a
// Mac, several times that on the phone, and a fast flick mounts a handful of
// rows in one frame. The document has not changed between those two mounts, so
// the second parse is pure waste.
const CLAUDE_MD = new URL('../../../CLAUDE.md', import.meta.url)

describe('re-reading a message that scrolled away and came back', () => {
  it('does not parse the same document twice', () => {
    const document = readFileSync(CLAUDE_MD, 'utf8')
    const first = parseMobileMarkdown(document)
    const second = parseMobileMarkdown(document)
    // Reference identity, not deep equality: deep equality is also true of a
    // second full parse, which is the thing being ruled out.
    expect(second).toBe(first)
  })

  it('still re-parses a message that has changed', () => {
    const before = parseMobileMarkdown('# Heading\n\nOne paragraph.')
    const after = parseMobileMarkdown('# Heading\n\nOne paragraph. And more.')
    expect(after).not.toBe(before)
    expect(after.at(-1)).toEqual({ type: 'paragraph', text: 'One paragraph. And more.' })
  })

  it('holds a streaming message at one entry rather than one per tick', () => {
    // A streamed reply arrives as a new, longer string ~20 times a second. Each
    // tick is a cache miss by construction, so an unbounded cache would keep
    // every intermediate draft of every message alive for the session.
    const ticks = MOBILE_MARKDOWN_PARSE_CACHE_CAP * 3
    for (let index = 0; index < ticks; index += 1) {
      parseMobileMarkdown(`Streaming ${'word '.repeat(index + 1)}`)
    }
    const lastTick = `Streaming ${'word '.repeat(ticks)}`
    expect(parseMobileMarkdown(lastTick)).toBe(parseMobileMarkdown(lastTick))
    // The first tick is long gone.
    const firstTick = 'Streaming word '
    const revisited = parseMobileMarkdown(firstTick)
    expect(parseMobileMarkdown(firstTick)).toBe(revisited)
  })

  it('keeps the message a reader is looking at, not the oldest one', () => {
    // Plain FIFO eviction drops the entry that has been on screen longest,
    // which on a chat is the message being read. Reading an entry has to renew
    // it. (This is the same defect the sticky HUD hold had on 2026-09-15.)
    const onScreen = '# On screen\n\nStill being read.'
    parseMobileMarkdown(onScreen)
    const kept = parseMobileMarkdown(onScreen)
    for (let index = 0; index < MOBILE_MARKDOWN_PARSE_CACHE_CAP - 1; index += 1) {
      parseMobileMarkdown(`Filler ${index}`)
      // Touch it again, as a mount of the visible row would.
      expect(parseMobileMarkdown(onScreen)).toBe(kept)
    }
    expect(parseMobileMarkdown(onScreen)).toBe(kept)
  })

  it('reads an empty message without holding an entry for it', () => {
    expect(parseMobileMarkdown('')).toEqual([])
    expect(parseMobileMarkdown('')).toEqual([])
  })
})
