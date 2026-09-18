import { beforeEach, describe, expect, it } from 'vitest'
import {
  claimAppUpdateDialogPresenter,
  isAppUpdateDialogPresenter,
  releaseAppUpdateDialogPresenter,
  resetAppUpdateDialogPresenterForTests,
  subscribeAppUpdateDialogPresenter
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

    claimAppUpdateDialogPresenter(home)
    claimAppUpdateDialogPresenter(about)
    expect(isAppUpdateDialogPresenter(home)).toBe(false)
    expect(isAppUpdateDialogPresenter(about)).toBe(true)
  })

  /**
   * "First claim wins" put the dialog on the screen UNDERNEATH. Reported
   * 2026-09-18: tap Check for updates on About, nothing appears; go back to
   * Home and the banner is there. About is pushed over Home in the router
   * stack, so Home had mounted first and held the claim, and the dialog opened
   * on Home's copy behind About. The screen on top is the one the user can
   * see, so the LAST claim wins — and the copy that lost must be told, or both
   * would go on presenting.
   */
  it('gives the dialog to the screen on top, and takes it off the one beneath', () => {
    const home = Symbol('home')
    const about = Symbol('about')
    const seen: boolean[] = []
    claimAppUpdateDialogPresenter(home)
    const stop = subscribeAppUpdateDialogPresenter(() => seen.push(isAppUpdateDialogPresenter(home)))

    claimAppUpdateDialogPresenter(about)

    expect(seen).toEqual([false])
    expect(isAppUpdateDialogPresenter(about)).toBe(true)
    stop()
  })

  it('hands the dialog to the screen still mounted when the first one leaves', () => {
    const home = Symbol('home')
    const about = Symbol('about')
    claimAppUpdateDialogPresenter(home)
    claimAppUpdateDialogPresenter(about)

    releaseAppUpdateDialogPresenter(home)

    // About must be able to take over, or leaving Home would silence updates.
    expect(isAppUpdateDialogPresenter(about)).toBe(true)
  })

  it('hands the dialog back to the screen beneath when the top one leaves', () => {
    const home = Symbol('home')
    const about = Symbol('about')
    claimAppUpdateDialogPresenter(home)
    claimAppUpdateDialogPresenter(about)

    releaseAppUpdateDialogPresenter(about)

    expect(isAppUpdateDialogPresenter(home)).toBe(true)
    expect(isAppUpdateDialogPresenter(about)).toBe(false)
  })

  it('lets the same screen re-claim without stealing from itself', () => {
    const home = Symbol('home')
    claimAppUpdateDialogPresenter(home)
    claimAppUpdateDialogPresenter(home)
    expect(isAppUpdateDialogPresenter(home)).toBe(true)
  })

  it('ignores a release from a screen that never held it', () => {
    const home = Symbol('home')
    const about = Symbol('about')
    claimAppUpdateDialogPresenter(home)

    releaseAppUpdateDialogPresenter(about)

    expect(isAppUpdateDialogPresenter(home)).toBe(true)
    expect(isAppUpdateDialogPresenter(about)).toBe(false)
  })
})
