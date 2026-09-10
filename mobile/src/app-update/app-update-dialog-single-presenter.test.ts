import { beforeEach, describe, expect, it } from 'vitest'
import {
  claimAppUpdateDialogPresenter,
  releaseAppUpdateDialogPresenter,
  resetAppUpdateDialogPresenterForTests
} from './app-update-dialog-presenter'

describe('how many update dialogs a screen may show at once', () => {
  beforeEach(() => resetAppUpdateDialogPresenterForTests())

  it('shows one dialog when Home and About are both on the stack', () => {
    // Reported 2026-09-10: checking for updates from About put the dialog up,
    // and dismissing it left another one over the list. An Expo Router stack
    // keeps Home mounted underneath About, and both screens mount their own
    // copy of this dialog, so the same store state opened two of them.
    const home = Symbol('home')
    const about = Symbol('about')

    expect(claimAppUpdateDialogPresenter(home)).toBe(true)
    expect(claimAppUpdateDialogPresenter(about)).toBe(false)
  })

  it('hands the dialog to the screen still mounted when the first one leaves', () => {
    const home = Symbol('home')
    const about = Symbol('about')
    claimAppUpdateDialogPresenter(home)
    claimAppUpdateDialogPresenter(about)

    releaseAppUpdateDialogPresenter(home)

    // About must be able to take over, or leaving Home would silence updates.
    expect(claimAppUpdateDialogPresenter(about)).toBe(true)
  })

  it('lets the same screen re-claim without stealing from itself', () => {
    const home = Symbol('home')
    expect(claimAppUpdateDialogPresenter(home)).toBe(true)
    expect(claimAppUpdateDialogPresenter(home)).toBe(true)
  })

  it('ignores a release from a screen that never held it', () => {
    const home = Symbol('home')
    const about = Symbol('about')
    claimAppUpdateDialogPresenter(home)

    releaseAppUpdateDialogPresenter(about)

    expect(claimAppUpdateDialogPresenter(about)).toBe(false)
    expect(claimAppUpdateDialogPresenter(home)).toBe(true)
  })
})
