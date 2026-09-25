import { describe, expect, it } from 'vitest'
import { isReaderScrollMotion } from './mobile-chat-scroll-motion'

// What the chat list's scroll events look like, in dp, and which of them are
// the list moving under the reader. The place-holding shape is FlashList's
// `maintainVisibleContentPosition` answering a streaming reply that grew one
// 24 dp line above the reader (2026-09-25).
describe('telling the reader’s scroll from the list holding their place', () => {
  it('reads a correction that moved by exactly what the content grew as holding still', () => {
    expect(isReaderScrollMotion({ offset: 1800, height: 5000 }, { offset: 1824, height: 5024 })).toBe(false)
  })

  it('reads a correction that is a pixel off the growth as holding still', () => {
    // 1 px at 3x is a third of a dp; the anchor and the content round apart.
    expect(isReaderScrollMotion({ offset: 1800, height: 5000 }, { offset: 1824.67, height: 5024 })).toBe(false)
  })

  it('reads the content shrinking under a correction as holding still', () => {
    expect(isReaderScrollMotion({ offset: 1800, height: 5000 }, { offset: 1752, height: 4952 })).toBe(false)
  })

  it('reads a fling frame with no growth as movement', () => {
    expect(isReaderScrollMotion({ offset: 1800, height: 5000 }, { offset: 1840, height: 5000 })).toBe(true)
  })

  it('reads a fling frame that also carried the stream’s growth as movement', () => {
    expect(isReaderScrollMotion({ offset: 1800, height: 5000 }, { offset: 1864, height: 5024 })).toBe(true)
  })

  it('reads a re-pin to the live edge as movement, since the list did move', () => {
    expect(isReaderScrollMotion({ offset: 12, height: 5000 }, { offset: 0, height: 5024 })).toBe(true)
  })

  it('reads a sample that went nowhere as no movement', () => {
    expect(isReaderScrollMotion({ offset: 0, height: 5000 }, { offset: 0, height: 5000 })).toBe(false)
    expect(isReaderScrollMotion({ offset: 0, height: 5000 }, { offset: 0, height: 5024 })).toBe(false)
  })

  it('counts the very first sample as movement, having nothing to compare it with', () => {
    expect(isReaderScrollMotion(null, { offset: 0, height: 0 })).toBe(true)
  })

  it('counts a sample with no usable height as movement, the side the 2026-09-12 rule needs', () => {
    expect(isReaderScrollMotion({ offset: 1800, height: 5000 }, { offset: 1824, height: Number.NaN })).toBe(true)
    expect(isReaderScrollMotion({ offset: 1800, height: Number.NaN }, { offset: 1824, height: 5024 })).toBe(true)
  })

  it('handles an empty list, where offset and height are both zero', () => {
    expect(isReaderScrollMotion({ offset: 0, height: 0 }, { offset: 0, height: 0 })).toBe(false)
  })
})
