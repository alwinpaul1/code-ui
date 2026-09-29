import { describe, expect, it } from 'vitest'
import { clipWithEllipsis, cutWholeCharacters } from './whole-character-cut'

// What a cut through a surrogate pair leaves behind: a high half with no low
// half after it, or a low half with no high half before it.
const LONE_HALF = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const ROCKET = '🚀'
// "𝗯𝗼𝗹𝗱": the Mathematical Sans-Serif Bold letters notification-plain-text.ts
// writes for **bold**, each one a surrogate pair like an emoji.
const BOLD = '\u{1D5EF}\u{1D5FC}\u{1D5F9}\u{1D5F1}'

describe('cutting at a cap without cutting a character in half', () => {
  it('ends before an emoji that straddles the cut', () => {
    expect(cutWholeCharacters(`abc${ROCKET}def`, 4)).toBe('abc')
  })

  it('keeps an emoji that ends exactly at the cut', () => {
    expect(cutWholeCharacters(`abc${ROCKET}def`, 5)).toBe(`abc${ROCKET}`)
  })

  it('keeps a string that fits exactly, and cuts one a code unit over', () => {
    expect(cutWholeCharacters(`abc${ROCKET}`, 5)).toBe(`abc${ROCKET}`)
    expect(cutWholeCharacters(`abcd${ROCKET}`, 5)).toBe('abcd')
  })

  it('returns nothing for an empty string, a zero cap or a negative one', () => {
    expect(cutWholeCharacters('', 10)).toBe('')
    expect(cutWholeCharacters('', 0)).toBe('')
    expect(cutWholeCharacters(ROCKET, 0)).toBe('')
    expect(cutWholeCharacters('abc', -1)).toBe('')
  })

  it('returns nothing rather than half of a one-emoji string cut to one code unit', () => {
    expect(cutWholeCharacters(ROCKET, 1)).toBe('')
    expect(cutWholeCharacters(ROCKET, 2)).toBe(ROCKET)
  })

  it('cuts a string made only of emoji between two of them at an odd cap and an even one', () => {
    expect(cutWholeCharacters(ROCKET.repeat(5), 5)).toBe(ROCKET.repeat(2))
    expect(cutWholeCharacters(ROCKET.repeat(5), 6)).toBe(ROCKET.repeat(3))
  })

  it('treats the bold letterforms of a notification the same as an emoji', () => {
    expect(cutWholeCharacters(`x${BOLD}`, 4)).toBe(`x\u{1D5EF}`)
  })

  it('drops a lone high half already sitting at the cut', () => {
    expect(cutWholeCharacters('ab\uD83Dcd', 3)).toBe('ab')
  })

  it('agrees with slice on text with no surrogate pairs, at every cap', () => {
    const plain = 'Build 0.2.60 locally — für das Telefon'
    for (let cap = 0; cap <= plain.length + 1; cap += 1) {
      expect(cutWholeCharacters(plain, cap)).toBe(plain.slice(0, cap))
    }
  })

  it('never leaves half a character, at every cap across mixed text', () => {
    const mixed = `a${ROCKET}${ROCKET}b${BOLD} c👨‍👩‍👧 🇩🇪!`
    for (let cap = 0; cap <= mixed.length + 1; cap += 1) {
      const cut = cutWholeCharacters(mixed, cap)
      expect(cut).not.toMatch(LONE_HALF)
      expect(mixed.startsWith(cut)).toBe(true)
      // Never longer than the cap, and at most one code unit shorter.
      expect(cut.length).toBeLessThanOrEqual(Math.max(0, cap))
      expect(cut.length).toBeGreaterThanOrEqual(Math.min(mixed.length, Math.max(0, cap)) - 1)
    }
  })

  // The documented limit: a family emoji is several characters joined by
  // ZWJ, and a cut may keep some of them. Every piece is still a whole
  // character, so nothing draws as a replacement box.
  it('may split a ZWJ family into whole people, never into half of one', () => {
    const family = '👨‍👩‍👧'
    const cut = cutWholeCharacters(family, 4)
    expect(cut).toBe('👨‍')
    expect(cut).not.toMatch(LONE_HALF)
  })
})

describe('clipping with an ellipsis', () => {
  it('leaves a string that fits alone, emoji at the end included', () => {
    expect(clipWithEllipsis(`abc${ROCKET}`, 5)).toBe(`abc${ROCKET}`)
  })

  it('ends before an emoji that straddles the cut, then adds the ellipsis', () => {
    // Cap 6: five code units of text and the ellipsis; the rocket sits on 4 and 5.
    expect(clipWithEllipsis(`abcd${ROCKET}ef`, 6)).toBe('abcd…')
    expect(clipWithEllipsis(`abc${ROCKET}def`, 6)).toBe(`abc${ROCKET}…`)
  })

  it('cuts a string one code unit over the cap', () => {
    expect(clipWithEllipsis('abcdefg', 6)).toBe('abcde…')
  })

  it('returns an empty string as it is, and nothing for a cap of zero', () => {
    expect(clipWithEllipsis('', 6)).toBe('')
    expect(clipWithEllipsis('abc', 0)).toBe('')
  })

  it('never returns more than the cap, even when the cap leaves room for the ellipsis alone', () => {
    expect(clipWithEllipsis(ROCKET, 1)).toBe('…')
    expect(clipWithEllipsis(ROCKET.repeat(3), 4)).toBe(`${ROCKET}…`)
    expect(clipWithEllipsis(ROCKET.repeat(3), 3)).toBe(`${ROCKET}…`)
  })
})
