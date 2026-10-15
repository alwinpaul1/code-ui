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
// requestDisallowInterceptTouchEvent, so a finger on a Text that drags scrolls the list, the Text
// hears nothing more of the gesture (its ACTION_CANCEL comes only at the next finger down; see
// selection-root-cancels-hold-when-list-scrolls.test.ts), no lift comes, and the word stays lit
// with no menu. The same report: "when scrolling, the hold to copy triggers too sometimes".
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
    expect(dispatch).toMatch(/ACTION_CANCEL[\s\S]*armSweep\(/)
    expect(body(root(), 'armSweep')).toMatch(/sweepStrays\(/)
    const sweep = body(root(), 'sweepStrays')
    expect(sweep).toMatch(/isStraySelection\(/)
    expect(sweep).toMatch(/LiveSelections\.isLive\(/)
    expect(sweep).toMatch(/Selection\.removeSelection\(/)
    expect(sweep).toMatch(/Log\.w\(/)
  })

  it('clears one still without a menu a while after the finger lifted', () => {
    const dispatch = body(root(), 'dispatchTouchEvent')
    expect(dispatch).toMatch(/ACTION_UP[\s\S]*postDelayed\(armSweep\(/)
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

// Review of 1245b7fdd: every lift armed a sweep 2.5 s later that belonged to no gesture. Tap to stop
// a fling, press a word 1.6-2.0 s later and keep holding: the long press lights it at 2.1-2.5 s,
// the tap's old sweep fires at 2.5 s, sees lit words with no menu (that opens only at the lift)
// and clears them under the finger, and the hold gives nothing. The decision is GestureClock,
// pinned in StraySweepTest.kt; these pin that the root actually consults it.
describe('a sweep armed by one gesture never runs in the next', () => {
  it('starts a new gesture, and cancels the pending sweep, on every finger down', () => {
    const dispatch = body(root(), 'dispatchTouchEvent')
    const down = dispatch.slice(dispatch.indexOf('ACTION_DOWN'), dispatch.indexOf('ACTION_MOVE'))
    expect(down).toMatch(/gestures\.down\(\)/)
    expect(down).toMatch(/cancelPendingSweep\(\)/)
    expect(body(root(), 'cancelPendingSweep')).toMatch(/removeCallbacks\(it\)/)
    // A new sweep replaces the last one's, so only one is ever pending to cancel.
    expect(body(root(), 'armSweep')).toMatch(/cancelPendingSweep\(\)[\s\S]*pendingSweep = sweep/)
  })

  it('a cancelled sweep hands its baseline on, so words the last gesture lit with no menu are still strays', () => {
    // Without this, a second tap inside the grace would snapshot the first gesture's stray as
    // "held before this gesture" and nothing would ever clear it.
    const dispatch = body(root(), 'dispatchTouchEvent')
    const down = dispatch.slice(dispatch.indexOf('ACTION_DOWN'), dispatch.indexOf('ACTION_MOVE'))
    expect(down).toMatch(/val unswept = cancelPendingSweep\(\)[\s\S]*selectedAtDown = unswept \?: selectionsBelow\(\)/)
    expect(body(root(), 'cancelPendingSweep')).toMatch(/return before/)
  })

  it('the lift sweep checks the gesture it was armed in before it clears anything', () => {
    const source = root()
    const dispatch = body(source, 'dispatchTouchEvent')
    const up = dispatch.slice(dispatch.indexOf('ACTION_UP'), dispatch.indexOf('ACTION_CANCEL'))
    expect(up).toMatch(/gestures\.ended\(\)/)
    expect(up).toMatch(/postDelayed\(armSweep\(gestures\.gesture,/)
    const arm = body(source, 'armSweep')
    expect(arm).toMatch(/if \(!gestures\.stillDue\(armed\)\)[\s\S]*return[\s\S]*sweepStrays\(/)
  })

  it('the cancel sweep checks its gesture too', () => {
    const dispatch = body(root(), 'dispatchTouchEvent')
    const cancel = dispatch.slice(dispatch.indexOf('ACTION_CANCEL'))
    expect(cancel).toMatch(/gestures\.ended\(\)/)
    expect(cancel).toMatch(/post\(armSweep\(gestures\.gesture,/)
  })

  it('cancels a pending sweep when the document leaves the window', () => {
    expect(body(root(), 'onDetachedFromWindow')).toMatch(/cancelPendingSweep\(\)/)
  })
})

describe('the sweep never clears a selection put back and waiting for its menu', () => {
  it('a sweep counts a restore awaiting its menu as live', () => {
    expect(body(root(), 'sweepStrays')).toMatch(/LiveSelections\.isLive\(text, after\)/)
    expect(code('StraySelection.kt')).toMatch(
      /fun isLive\(text: TextView, current: SelectedRange\?\): Boolean =\s*live\.containsKey\(text\) \|\| awaitingMenu\.isAwaiting\(text, current\)/,
    )
  })

  it('every put-back marks its words as awaiting their menu, and an opening clears the mark', () => {
    expect(body(code('HeldSelection.kt'), 'reselect')).toMatch(/LiveSelections\.restored\(/)
    expect(body(code('StraySelection.kt'), 'opened')).toMatch(/awaitingMenu\.forget\(text\)/)
  })
})

describe('the static selection registry never keeps a Text that left the window', () => {
  it('a watched Text that detaches leaves the registry', () => {
    const source = root()
    expect(body(source, 'onCreateActionMode')).toMatch(/addOnAttachStateChangeListener\(this\)/)
    expect(body(source, 'onViewDetachedFromWindow')).toMatch(/stopWatching\(\)/)
    expect(body(source, 'stopWatching')).toMatch(/removeOnAttachStateChangeListener\(this\)/)
  })

  it('dropping a selection whose Text already left finishes no mode and reports nothing', () => {
    const drop = body(root(), 'drop')
    expect(drop).toMatch(/if \(!text\.isAttachedToWindow\) \{[\s\S]*?stopWatching\(\)[\s\S]*?return\s*\}/)
  })
})
