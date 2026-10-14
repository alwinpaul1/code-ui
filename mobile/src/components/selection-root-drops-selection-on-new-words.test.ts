import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The user's phone, 2026-10-14 13:30: after a scroll the highlight sat on other words, because
// FlashList handed the row (and its TextViews) to another message (chat-selection-stays-on-its-
// message.test.ts fixes the list). The native root is the second line: while a selection is open
// it compares the words the selection holds with what its Text now draws, before each frame.
//
// 2026-10-14, later: a streaming reply re-sets its Text on every tick, and Android ends the
// selection each time. The Claude app keeps a selection while the reply grows. So the root keeps
// it where the selected words still stand at the same place (selectionStillHolds, pinned in
// HeldSelectionTest.kt) and puts it back with the menu, and drops it only where those words
// changed. The same put-back serves a row drawn again after a scroll (`restoreSelection`).
//
// No JavaScript handle reaches a TextView, so this reads the Kotlin, comments stripped.

const DIR = new URL(
  '../../modules/orca-selection-copy/android/src/main/java/expo/modules/orcaselectioncopy/',
  import.meta.url
)

function code(file: string): string {
  return readFileSync(new URL(file, DIR), 'utf8')
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

const ROOT = 'SelectionCopyRootView.kt'

describe('a selection keeps to its words, never to other words', () => {
  it('watches the selection only while it is open', () => {
    const root = code(ROOT)
    expect(body(root, 'onCreateActionMode')).toMatch(/viewTreeObserver\.also \{ it\.addOnPreDrawListener\(this\) \}/)
    expect(body(root, 'onDestroyActionMode')).toMatch(/stopWatching\(\)/)
    expect(body(root, 'stopWatching')).toMatch(/\.removeOnPreDrawListener\(this\)/)
  })

  it('puts the selection back when its words still stand, and drops it when they changed', () => {
    const check = body(code(ROOT), 'onPreDraw')
    expect(check).toMatch(/selectionStillHolds\(/)
    expect(check).toMatch(/reselect\(text, held\)/)
    expect(check).toMatch(/Selection\.removeSelection\(/)
    expect(check).toMatch(/mode\?\.finish\(\)/)
    expect(check).toMatch(/Log\.w\("OrcaSelectionCopy", "Selection dropped: its words changed/)
    // The frame still draws: a pre-draw listener that returned false would cancel it.
    expect(check).not.toMatch(/return false/)
  })

  it('reports a selection the reader moved, so the chat holds the words they mean', () => {
    expect(body(code(ROOT), 'onPreDraw')).toMatch(/moved\(/)
  })

  it('treats a menu closed by a text change it can survive as no close at all', () => {
    const destroyed = body(code(ROOT), 'onDestroyActionMode')
    expect(destroyed).toMatch(/selectionStillHolds\(/)
    expect(destroyed).toMatch(/reselect\(text, held\)/)
  })

  it('reselects through the TextView’s own selection action, so the handles and Copy come back', () => {
    const reselect = body(code('HeldSelection.kt'), 'reselect')
    expect(reselect).toMatch(/AccessibilityNodeInfo\.ACTION_SET_SELECTION/)
    expect(reselect).toMatch(/selectionStillHolds\(/)
  })

  it('puts a held selection back into a row drawn again, on the Text it was in', () => {
    const root = code(ROOT)
    expect(code('OrcaSelectionCopyModule.kt')).toMatch(/Prop\("restoreSelection"\)/)
    expect(body(root, 'restoreHeld')).toMatch(/textViewsBelow\(this\)\.getOrNull\(held\.run\)/)
    expect(body(root, 'restoreHeld')).toMatch(/reselect\(/)
    expect(body(root, 'onLayout')).toMatch(/restoreHeld\(\)/)
  })
})
