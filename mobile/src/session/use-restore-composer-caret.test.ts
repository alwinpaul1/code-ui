import { describe, expect, it } from 'vitest'
import { shouldRestoreComposerCaret } from './composer-caret-restore'

describe('the slash menu taking the caret', () => {
  it('puts the caret back while the keyboard is still up and the menu just moved', () => {
    expect(
      shouldRestoreComposerCaret({
        typing: true,
        keyboardVisible: true,
        menuOpen: true,
        sinceMenuChangeMs: 40
      })
    ).toBe(true)
    // Backspace that closes the menu moves the field the same way.
    expect(
      shouldRestoreComposerCaret({
        typing: true,
        keyboardVisible: true,
        menuOpen: false,
        sinceMenuChangeMs: 40
      })
    ).toBe(true)
  })

  it('leaves the caret alone once the keyboard has gone', () => {
    expect(
      shouldRestoreComposerCaret({
        typing: true,
        keyboardVisible: false,
        menuOpen: true,
        sinceMenuChangeMs: 40
      })
    ).toBe(false)
    expect(
      shouldRestoreComposerCaret({
        typing: true,
        keyboardVisible: true,
        menuOpen: false,
        sinceMenuChangeMs: 5_000
      })
    ).toBe(false)
    expect(
      shouldRestoreComposerCaret({
        typing: false,
        keyboardVisible: true,
        menuOpen: true,
        sinceMenuChangeMs: 0
      })
    ).toBe(false)
    // Back dismisses the keyboard while `/` is still in the box. The menu is
    // still open, and on Android the keyboard reports itself visible until the
    // hide animation finishes. That blur is the user leaving, so the caret
    // must stay gone.
    expect(
      shouldRestoreComposerCaret({
        typing: true,
        keyboardVisible: true,
        menuOpen: true,
        sinceMenuChangeMs: 5_000
      })
    ).toBe(false)
  })
})
