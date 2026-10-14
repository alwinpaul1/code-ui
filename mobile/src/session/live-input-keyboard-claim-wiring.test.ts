import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The live field's keyboard claim (use-terminal-live-input-focus.ts) has two
// structural halves with no behavioural handle short of mounting the whole
// session controller. The runtime must report the screen's navigation focus,
// or the claim never fires and every hook test stays green. And every path
// that puts the keyboard away on purpose must release it first, or the claim
// raises the keyboard again when keyboardDidHide lands after the settle. Read
// from the code with comments stripped, so prose cannot satisfy it.

const SESSION = import.meta.dirname

function code(file: string): string {
  return readFileSync(join(SESSION, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** The body of `useCallback(` that starts at the first match of `opener`. */
function callbackBody(source: string, opener: RegExp): string {
  const start = source.search(opener)
  expect(start, String(opener)).toBeGreaterThanOrEqual(0)
  return source.slice(start, source.indexOf('}, [', start))
}

describe('the live field keyboard claim wiring', () => {
  it('reports the session screen gaining and losing focus', () => {
    const runtime = code('use-mobile-session-terminal-runtime.ts')
    const effect = runtime.slice(runtime.indexOf('useFocusEffect('))
    expect(effect).toMatch(
      /reportLiveInputScreenFocus\(true\)[\s\S]*return \(\) => \{\s*reportLiveInputScreenFocus\(false\)/
    )
  })

  it('releases the keyboard before turning live input off', () => {
    const body = callbackBody(
      code('use-mobile-session-terminal-input.ts'),
      /const toggleLiveInput = useCallback/
    )
    expect(body.slice(body.indexOf('} else {'))).toMatch(
      /releaseLiveInputKeyboard\(\)[\s\S]*liveInputRef\.current\?\.blur\(\)/
    )
  })

  it('releases the keyboard before a dismissal and before the tab action sheet', () => {
    const sendActions = code('use-mobile-session-terminal-send-actions.ts')
    expect(callbackBody(sendActions, /const dismissSoftwareKeyboard = useCallback/)).toContain(
      'releaseLiveInputKeyboard()'
    )
    const sheet = sendActions.slice(
      sendActions.indexOf('openSessionTabActionSheetAfterKeyboardDismiss')
    )
    expect(sheet).toMatch(
      /releaseLiveInputKeyboard\(\)[\s\S]*liveInputRef\.current\?\.blur\(\)\s*Keyboard\.dismiss\(\)/
    )
  })

  it('releases the keyboard when select mode puts it away', () => {
    const body = callbackBody(
      code('use-mobile-session-accessory-selection.ts'),
      /const handleSelectionMode = useCallback/
    )
    expect(body).toMatch(/releaseLiveInputKeyboard\(\)\s*Keyboard\.dismiss\(\)/)
  })
})
