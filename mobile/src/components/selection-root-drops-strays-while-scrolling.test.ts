import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The user's recording, 2026-10-15 (0.9.150, frames rec2/f_006-f_039, logcat OrcaSelectionCopy):
// "answered" was held with its Copy / Select all menu; the reader scrolled, and the highlight came
// back on other words, "pictures" in the same paragraph and "used" in a table cell, with no menu,
// and "used" stayed lit to the end of the recording. The log has a "Selection opened" line for
// "answered" and, 3 s after "pictures" was already lit, one for "pictures"; "used" never has one.
// So those words were selected without the selection's action mode ever opening: invisible to
// the chat's tracking (it hears a selection only through that mode), and nothing ever cleared them.
//
// How a hold makes such a selection: Android selects the word under a long press at once and
// opens the menu only when the finger lifts (Editor.selectCurrentWordAndStartDrag, then
// startSelectionActionModeAsync at ACTION_UP). The chat's scroll view sits in a gesture-handler
// Gesture.Native(), which asks the ScrollView to intercept directly (NativeViewGestureHandler
// .tryIntercept, react-native-gesture-handler 2.32.0) whatever the Text asked with
// requestDisallowInterceptTouchEvent, so a finger that rested and then dragged scrolls the list,
// the Text gets ACTION_CANCEL, no lift comes, and the word stays lit with no menu. The same
// report: "when scrolling, the hold to copy triggers too sometimes".
//
// Three rules in the document's native root, which sees every touch before its Texts:
// 1. A finger that moves past the touch slop before the long-press timeout is a drag, and its
//    Texts' pending long press is cancelled, as a Compose long press is cancelled by moving.
// 2. A selection a gesture made that has no menu when the gesture is cancelled, or still none a
//    while after the finger lifts, is a stray and is cleared, with a log line (rule 9).
// 3. One selection at a time: one opening drops any other still held in the chat.
// There is no JavaScript handle on a native touch, so this reads the Kotlin, comments stripped;
// the decisions themselves are pure functions pinned in StraySelectionTest.kt.

const DIR = '../../modules/orca-selection-copy/android/src/main/java/expo/modules/orcaselectioncopy/'

function code(file: string): string {
  return readFileSync(new URL(`${DIR}${file}`, import.meta.url), 'utf8')
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

const root = () => code('SelectionCopyRootView.kt')

describe('a scroll never leaves words lit that the reader did not select', () => {
  it('cancels a pending hold once the finger has moved past the touch slop', () => {
    const dispatch = body(root(), 'dispatchTouchEvent')
    expect(dispatch).toMatch(/ACTION_MOVE[\s\S]*movedPastSlop\(/)
    expect(dispatch).toMatch(/getLongPressTimeout\(\)/)
    expect(body(root(), 'cancelPendingHolds')).toMatch(/\.cancelLongPress\(\)/)
  })

  it('clears a selection the cancelled gesture made before any menu opened', () => {
    const dispatch = body(root(), 'dispatchTouchEvent')
    expect(dispatch).toMatch(/ACTION_CANCEL[\s\S]*sweepStrays\(/)
    const sweep = body(root(), 'sweepStrays')
    expect(sweep).toMatch(/isStraySelection\(/)
    expect(sweep).toMatch(/LiveSelections\.watching\(/)
    expect(sweep).toMatch(/Selection\.removeSelection\(/)
    expect(sweep).toMatch(/Log\.w\(/)
  })

  it('clears one still without a menu a while after the finger lifted', () => {
    const dispatch = body(root(), 'dispatchTouchEvent')
    expect(dispatch).toMatch(/ACTION_UP[\s\S]*postDelayed\([\s\S]*sweepStrays\(/)
  })

  it('compares against what each Text held when the finger went down, so a held selection is never a stray', () => {
    const dispatch = body(root(), 'dispatchTouchEvent')
    expect(dispatch).toMatch(/ACTION_DOWN[\s\S]*selectionsBelow\(\)/)
  })

  it('keeps one selection at a time: one opening drops any other still held', () => {
    const callback = code('SelectionCopyRootView.kt')
    const create = body(callback, 'onCreateActionMode')
    expect(create).toMatch(/LiveSelections\.opened\(text, this\)/)
    expect(create).toMatch(/\.drop\(/)
    expect(body(callback, 'stopWatching')).toMatch(/LiveSelections\.closed\(text, this\)/)
  })
})

describe('a row handed to another message drops the selection it held', () => {
  it('drops every live selection below when its document key changes', () => {
    const set = body(root(), 'setDocumentKey')
    expect(set).toMatch(/LiveSelections\.callbackFor\(/)
    expect(set).toMatch(/\.drop\(/)
  })

  it('takes the key as a prop', () => {
    expect(code('OrcaSelectionCopyModule.kt')).toMatch(/Prop\("documentKey"\)[\s\S]*setDocumentKey\(/)
  })
})
