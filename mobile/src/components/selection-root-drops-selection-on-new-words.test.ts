import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The user's phone, 2026-10-14 13:30: after a scroll the highlight sat on other words, because
// FlashList handed the row (and its TextViews) to another message (see
// chat-selection-stays-on-its-message.test.ts, which fixes the list). This is the second line of
// defence, in the native root: a TextView that holds a selection and is given other words drops
// the selection and closes its Copy menu, so a reused view can never show a stale selection on
// text nobody selected. Android tells no one when a Text's words change, so the root compares the
// text the selection was made on with the one the view draws, before each frame, while a selection
// is open. No JavaScript handle reaches a TextView's text, so this reads the Kotlin, comments
// stripped.

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

describe('a reused Text never keeps a selection on words nobody selected', () => {
  it('remembers the words a selection was made on and watches them only while it is open', () => {
    const root = code()
    const created = body(root, 'onCreateActionMode')
    expect(created).toMatch(/heldText = text\.text\.toString\(\)/)
    expect(created).toMatch(/viewTreeObserver\.also \{ it\.addOnPreDrawListener\(this\) \}/)
    expect(body(root, 'onDestroyActionMode')).toMatch(/\.removeOnPreDrawListener\(this\)/)
  })

  it('drops the selection and closes the menu when the view is given other words, and says so', () => {
    const check = body(code(), 'onPreDraw')
    // The words, not the object: the same words set again by a re-render are not other words.
    expect(check).toMatch(/text\.text\.toString\(\) != heldText/)
    expect(check).toMatch(/Selection\.removeSelection\(/)
    expect(check).toMatch(/mode\.finish\(\)/)
    expect(check).toMatch(/Log\.w\("OrcaSelectionCopy", "Selection dropped: the Text was given other words/)
    // The frame still draws: a pre-draw listener that returned false would cancel it.
    expect(check).toMatch(/return true/)
    expect(check).not.toMatch(/return false/)
  })
})
