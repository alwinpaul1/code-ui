import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The user's phone, 2026-10-14 11:08: a selection held in a reply was gone after a drag of the
// transcript, on a build whose chat already waited for word of a live selection before switching
// `selectable` off (5bccae5ce). Switching `selectable` off is what ends a selection on Android
// (setTextIsSelectable(false) re-sets the text without one), so the guard against a stray hold
// during a scroll (2026-09-12) now lives in the document's native root and never touches it: the
// root makes its Texts not long-clickable while a scroll is in flight, which stops a NEW
// selection and leaves an open one alone. There is no JavaScript handle on a TextView's flags, so
// this reads the Kotlin, comments stripped, for the structure the fix rests on. It also pins the
// diagnostics: each way a selection can end on this path says so in logcat, by name.

const MODULES = new URL('../../modules/', import.meta.url)

function code(path: string): string {
  return readFileSync(new URL(path, MODULES), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
}

/** The body of the first `fun name(` in `source`, braces balanced. */
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

const ROOT = 'orca-selection-copy/android/src/main/java/expo/modules/orcaselectioncopy/'
const PROSE = 'orca-native-prose/android/src/main/java/expo/modules/orcanativeprose/NativeProseTextView.kt'

describe('the reply root stops a stray hold without ending a selection', () => {
  it('takes holdSelects as a prop', () => {
    expect(code(`${ROOT}OrcaSelectionCopyModule.kt`)).toMatch(
      /Prop\("holdSelects"\) \{ view: SelectionCopyRootView, holds: Boolean\? ->\s*view\.setHoldSelects\(holds != false\)/
    )
  })

  it('switches its Texts’ long-click, never their selectability', () => {
    const root = code(`${ROOT}SelectionCopyRootView.kt`)
    expect(body(root, 'applyHoldSelects')).toMatch(/\.isLongClickable = holdSelects/)
    expect(root).not.toMatch(/setTextIsSelectable|isTextSelectable\s*=/)
  })

  it('applies it when the prop changes and again at each touch down, for a Text mounted since', () => {
    const root = code(`${ROOT}SelectionCopyRootView.kt`)
    expect(body(root, 'setHoldSelects')).toMatch(/applyHoldSelects\(this\)/)
    expect(body(root, 'onInterceptTouchEvent')).toMatch(
      /ACTION_DOWN\) \{[^}]*applyHoldSelects\(this\)/
    )
  })
})

describe('a selection that ends says why in logcat', () => {
  it('logs the action mode opening and closing, and whether the words stayed selected', () => {
    const root = code(`${ROOT}SelectionCopyRootView.kt`)
    expect(body(root, 'onCreateActionMode')).toMatch(/Log\.i\(/)
    expect(body(root, 'onDestroyActionMode')).toMatch(/Log\.i\([^)]*hasSelection/)
  })

  it('logs the reply prose losing a selection to a new text, to selectable off, or to leaving the window', () => {
    const prose = code(PROSE)
    expect(body(prose, 'applyProps')).toMatch(/hasSelection\(\)[\s\S]*Log\.w\(TAG, "Selection dropped: the text was replaced/)
    expect(body(prose, 'applyProps')).toMatch(/Log\.w\(TAG, "Selection dropped: selectable switched off/)
    expect(body(prose, 'onDetachedFromWindow')).toMatch(/hasSelection\(\)[\s\S]*Log\.w\(TAG, "Selection dropped: the view left the window/)
  })
})
