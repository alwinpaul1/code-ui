import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The user's phone, 2026-10-14 17:21 (0.9.143): after selecting "while" and scrolling, the
// highlight sat on single other words ("the", "now", "match"). Each is a NEW word selection made
// by a double tap: a selectable TextView selects the word under the second touch of a double tap
// at ACTION_DOWN (Editor.java:7012-7021, android-36.1), and a reader who taps to stop a fling and
// touches again to scroll on makes one. Long-click being off during a scroll does not stop it.
//
// Not a shared Spannable carrying selection spans: TextView.setText copies every text it is given
// into a new SpannableString whenever a movement method is set, which a selectable Text always
// has, and otherwise into an immutable SpannedString (TextView.java:7426-7429), so no cache or
// second view can share the Spannable a selection lives on.
//
// The fix is in the document's native root, which sees every touch before its Texts: a touch that
// is the second of a double tap (isRepeatTap, pinned in RepeatTapTest.kt) is intercepted, so no
// Text sees it and the scroll view still does. The Claude app selects on a hold only. There is no
// JavaScript handle on a native touch, so this reads the Kotlin, comments stripped.

const ROOT = new URL(
  '../../modules/orca-selection-copy/android/src/main/java/expo/modules/orcaselectioncopy/SelectionCopyRootView.kt',
  import.meta.url
)

function code(): string {
  return readFileSync(ROOT, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
}

function body(source: string, name: string): string {
  const start = source.indexOf(`fun ${name}(`)
  expect(start, `fun ${name} is missing`).toBeGreaterThanOrEqual(0)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1
    } else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(open, index + 1)
      }
    }
  }
  throw new Error(`fun ${name} never closes`)
}

describe('a double tap never selects a word in the chat', () => {
  it('remembers where and when each touch lifted, whoever handled it', () => {
    const dispatch = body(code(), 'dispatchTouchEvent')
    expect(dispatch).toMatch(/ACTION_UP[\s\S]*lastUpAt = ev\.eventTime/)
    expect(dispatch).toMatch(/super\.dispatchTouchEvent\(ev\)/)
  })

  it('takes the second touch of a double tap away from its Texts', () => {
    const intercept = body(code(), 'onInterceptTouchEvent')
    expect(intercept).toMatch(/isRepeatTap\(lastUpAt, lastUpX, lastUpY, ev\.eventTime, ev\.x, ev\.y/)
    expect(intercept).toMatch(/return true/)
  })

  it('lets the taken touch go on to the scroll view', () => {
    expect(body(code(), 'onTouchEvent')).toMatch(/return false/)
  })
})
