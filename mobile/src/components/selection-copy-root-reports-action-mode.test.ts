import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The user, 2026-10-14: a selection held in a reply vanished on the first scroll of the chat.
// Whether a reply holds a selection is known only on the native side: Android opens the
// selection's action mode through the document's root (startActionModeForChild) and closes it
// when the selection ends. No JavaScript test can drive that, so this pins the structure the
// fix rests on, read from the code with its comments stripped: the root sends
// `onSelectionChange` with `active` true when the mode opens and false when it closes, and the
// module declares the event so Expo delivers it.

const MODULE_DIR = new URL(
  '../../modules/orca-selection-copy/android/src/main/java/expo/modules/orcaselectioncopy/',
  import.meta.url
)

/** Kotlin source with line and block comments taken out, so prose cannot satisfy a match. */
function code(file: string): string {
  return readFileSync(new URL(file, MODULE_DIR), 'utf8')
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

describe('the reply document root tells the chat when a selection is open', () => {
  it('sends onSelectionChange when a selection opens and when it closes', () => {
    const root = code('SelectionCopyRootView.kt')
    expect(root).toMatch(/val onSelectionChange by EventDispatcher\(\)/)
    const sent = body(root, 'selectionChanged')
    expect(sent).toMatch(/mapOf\("active" to active\)/)
    expect(sent).toMatch(/onSelectionChange\(payload\)/)
    // The menu wrapper: a created mode is a selection open (with where it is), a destroyed one a
    // selection gone unless its words are still selected or about to be put back.
    expect(body(root, 'onCreateActionMode')).toMatch(/if \(created\) \{[\s\S]*report\(true, held\)/)
    expect(body(root, 'onDestroyActionMode')).toMatch(/report\(false, null\)/)
  })

  it('wraps the menu of every Text it is asked for, the fallback menu included', () => {
    const start = body(code('SelectionCopyRootView.kt'), 'startActionModeForChild')
    expect(start).toMatch(
      /super\.startActionModeForChild\(originalView, SelectionLifeCallback\(menu, originalView, run, ::selectionChanged\)/
    )
  })

  it('declares the event, so Expo delivers it', () => {
    expect(code('OrcaSelectionCopyModule.kt')).toMatch(/Events\("onSelectionChange"\)/)
  })
})
