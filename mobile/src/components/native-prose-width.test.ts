import { describe, expect, it } from 'vitest'
import { lastNativeProseWidth, rememberNativeProseWidth } from './native-prose-width'

// A native prose run measures its height in the render that mounts it, from
// the document's width. A row FlashList mounts while the reader scrolls has
// no layout yet; with no width it would mount as a Text and turn native a
// frame later at another height, a jump under the reader. So a new row starts
// from the width its surface last had: its own surface, never a narrower card
// set in the same type (review, 2026-10-09: a plan card's width measured the
// next reply too tall).

describe('the width a new native prose row starts from', () => {
  it('is none before the surface has ever been laid out', () => {
    expect(lastNativeProseWidth('never-seen', 1)).toBe(0)
  })

  it('is the last width the same surface at the same zoom was laid out at', () => {
    rememberNativeProseWidth('reply', 1, 380.5)
    rememberNativeProseWidth('reply', 0.93, 350)
    expect(lastNativeProseWidth('reply', 1)).toBe(380.5)
    expect(lastNativeProseWidth('reply', 0.93)).toBe(350)
    rememberNativeProseWidth('reply', 1, 700)
    expect(lastNativeProseWidth('reply', 1)).toBe(700)
  })

  it('keeps each surface apart, whatever type they share', () => {
    rememberNativeProseWidth('reply', 1, 360)
    rememberNativeProseWidth('plan', 1, 320)
    expect(lastNativeProseWidth('reply', 1)).toBe(360)
    expect(lastNativeProseWidth('plan', 1)).toBe(320)
  })

  it('remembers nothing for a surface with no name, which then waits for its own layout', () => {
    rememberNativeProseWidth(undefined, 1, 360)
    expect(lastNativeProseWidth(undefined, 1)).toBe(0)
  })

  it('ignores a layout with no width, which would mount the next row at none', () => {
    rememberNativeProseWidth('reply', 2, 400)
    rememberNativeProseWidth('reply', 2, 0)
    expect(lastNativeProseWidth('reply', 2)).toBe(400)
  })
})
