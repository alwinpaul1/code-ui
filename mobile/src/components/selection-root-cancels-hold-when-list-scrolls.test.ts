import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The user, 2026-10-15: "Sometimes when scrolling the vibration triggers and text is somehow
// getting selected." A finger that lands on a selectable Text and drags the chat for longer than
// the long-press timeout buzzes and lights a word mid-scroll.
//
// Why the document's root never stopped it: the chat list scrolls under gesture-handler
// (Gesture.Native() in use-mobile-native-chat-pinch-gesture.ts). Once that handler activates, its
// root (RNGestureHandlerRootHelper.dispatchTouchEvent returns shouldIntercept, gesture-handler
// 2.32.0) stops passing the touch to the Android views below, whose ACTION_CANCEL for it comes
// only at the next finger down (ViewGroup.cancelAndClearTouchTargets); gesture-handler drives the
// ScrollView itself (NativeViewGestureHandler.tryIntercept, then
// onTouchEvent). The same swallow was found in the sheets on 2026-09-26 (SelectableSheetText.tsx).
// So the very MOVE that starts the scroll never reaches SelectionCopyRootView, its slop check
// never fires, no UP follows (nor a CANCEL, before the next down), and the Text's long press, armed at the down, goes off
// at the timeout: the haptic, and a word selected with no menu.
//
// What the root does now: from the finger down until it lifts or the hold goes off, it watches
// the window's scroll (a ViewTreeObserver listener, dispatched from the draw pass of the frame
// whose MOVE scrolled; read from the Android source as ahead of the long-press callback, not
// observed on a device). The document moving in its window by more than about a dp, under a
// finger that is still down, before the hold went off, means the list took the touch: the pending hold is cancelled (no haptic, no selection),
// the gesture ends there, and the stray sweep is armed for anything a hold lit before.
// There is no JavaScript handle on a native touch, so this reads the Kotlin, comments stripped;
// the decisions are pure functions pinned in ScrollTakesHoldTest.kt.

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

/** The branch of `dispatchTouchEvent` for one action, up to the next one. */
function branch(dispatch: string, action: string): string {
  const start = dispatch.indexOf(`MotionEvent.${action} ->`)
  expect(start, `${action} branch is missing`).toBeGreaterThanOrEqual(0)
  const next = dispatch.slice(start + action.length).search(/MotionEvent\.ACTION_[A-Z_]+ ->/)
  return next < 0 ? dispatch.slice(start) : dispatch.slice(start, start + action.length + next)
}

const root = () => code('SelectionCopyRootView.kt')

describe('a scroll of the chat never buzzes or selects a word under the finger', () => {
  it('watches the window scroll from the finger down', () => {
    const down = branch(body(root(), 'dispatchTouchEvent'), 'ACTION_DOWN')
    expect(down).toMatch(/getLocationInWindow\(/)
    expect(down).toMatch(/watchScroll\(\)/)
    expect(body(root(), 'watchScroll')).toMatch(/viewTreeObserver[\s\S]*addOnScrollChangedListener\(/)
  })

  it('cancels the pending hold, ends the gesture and sweeps when the list moves the document', () => {
    const took = body(root(), 'scrollTookTouch')
    expect(took).toMatch(/getLocationInWindow\(/)
    expect(took).toMatch(/scrolledUnderFinger\(/)
    expect(took).toMatch(/cancelPendingHolds\(\)/)
    expect(took).toMatch(/holdCancelled = true/)
    expect(took).toMatch(/gestures\.ended\(\)/)
    expect(took).toMatch(/armSweep\(/)
    expect(took).toMatch(/unwatchScroll\(\)/)
    // Rule 9: the one line it leaves behind names the cause.
    expect(took).toMatch(/Log\.[iw]\("OrcaSelectionCopy"/)
  })

  // Review of f93134c3d: in a plain ScrollView (the file preview, the Markdown reader, the
  // permission card) a still hold on a partly visible Text selects and asks for focus, and
  // ReactScrollView.requestChildFocus scrolls the Text into view. That scroll moved the document,
  // the watch took it for the list taking the touch, ended the gesture and swept the word the hold
  // had just lit, before its menu could open at the lift. The watch is only there to cancel a hold
  // that has not gone off; once it has, no scroll (that one, or an animated scrollTo) changes
  // anything.
  it('stops watching, without ending the gesture or sweeping, once the hold has gone off', () => {
    const took = body(root(), 'scrollTookTouch')
    const fired = took.search(/holdHasFired\(/)
    expect(fired, 'scrollTookTouch never asks whether the hold went off').toBeGreaterThanOrEqual(0)
    expect(fired).toBeLessThan(took.search(/gestures\.ended\(\)/))
    expect(fired).toBeLessThan(took.search(/armSweep\(/))
    expect(fired).toBeLessThan(took.search(/cancelPendingHolds\(\)/))
    // The branch it guards stops watching and returns, and nothing else.
    expect(took.slice(fired)).toMatch(/^holdHasFired\([^{]*\{\s*unwatchScroll\(\)\s*return\s*\}/)
    // "Lit this gesture": a Text below holds words it did not hold at the finger down.
    expect(took).toMatch(/holdHasFired\([^{]*litThisGesture\(\)/)
    const lit = body(root(), 'litThisGesture')
    expect(lit).toMatch(/selectedRangeIn\(/)
    expect(lit).toMatch(/selectedAtDown\[/)
    expect(took).toMatch(/SystemClock\.uptimeMillis\(\)\s*-\s*downAt/)
  })

  it('takes about a dp of movement for rounding, not a fixed pixel', () => {
    const took = body(root(), 'scrollTookTouch')
    expect(took).toMatch(/scrolledUnderFinger\([^)]*roundingTolerancePx\([^)]*density/)
  })

  it('stops watching when the finger lifts, the touch is cancelled or the document goes', () => {
    const dispatch = body(root(), 'dispatchTouchEvent')
    expect(branch(dispatch, 'ACTION_UP')).toMatch(/unwatchScroll\(\)/)
    expect(branch(dispatch, 'ACTION_CANCEL')).toMatch(/unwatchScroll\(\)/)
    expect(body(root(), 'onDetachedFromWindow')).toMatch(/unwatchScroll\(\)/)
    expect(body(root(), 'unwatchScroll')).toMatch(/removeOnScrollChangedListener\(/)
  })

  it('takes a drag that reaches the slop exactly at the long-press timeout for a drag', () => {
    const move = branch(body(root(), 'dispatchTouchEvent'), 'ACTION_MOVE')
    expect(move).toMatch(/dragCancelsHold\(/)
    expect(move).toMatch(/movedPastSlop\(/)
    expect(move).toMatch(/getLongPressTimeout\(\)/)
    expect(move).toMatch(/cancelPendingHolds\(\)/)
  })
})
