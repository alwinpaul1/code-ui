import { describe, expect, it } from 'vitest'
import {
  APP_UPDATE_TOUCH_SHIELD_TAIL_MS,
  nextTouchShieldState
} from './use-app-update-touch-shield'

describe('the screen underneath while the update dialog is closing', () => {
  it('keeps blocking touches after the dialog goes, so the press does not land behind it', () => {
    // Reproduced and recorded on a Galaxy S23 running 0.2.98. Holding Done for
    // 400 ms closes the dialog and flashes the pressed state on the repository
    // row underneath. The dialog is its own Android window; when it goes, the
    // system hands the rest of the gesture to the window behind. Deferring the
    // close by a frame did not help, because the window still disappears while
    // the finger is down.
    const shown = nextTouchShieldState({ shielded: false, dialogVisible: true, now: 1_000 })
    expect(shown.shielded).toBe(true)

    const justClosed = nextTouchShieldState({
      shielded: true,
      dialogVisible: false,
      now: 1_000,
      hiddenAt: 1_000
    })
    expect(justClosed.shielded).toBe(true)
  })

  it('lets the screen take touches again once the tail has passed', () => {
    const settled = nextTouchShieldState({
      shielded: true,
      dialogVisible: false,
      now: 1_000 + APP_UPDATE_TOUCH_SHIELD_TAIL_MS + 1,
      hiddenAt: 1_000
    })

    expect(settled.shielded).toBe(false)
  })

  it('never shields a screen that had no dialog', () => {
    const idle = nextTouchShieldState({ shielded: false, dialogVisible: false, now: 5_000 })

    expect(idle.shielded).toBe(false)
  })

  it('re-arms when the dialog opens again inside the tail', () => {
    const reopened = nextTouchShieldState({
      shielded: true,
      dialogVisible: true,
      now: 1_050,
      hiddenAt: 1_000
    })

    expect(reopened.shielded).toBe(true)
    expect(reopened.hiddenAt).toBeNull()
  })

  it('is short enough not to swallow a deliberate second tap', () => {
    // A person cannot dismiss and hit the row underneath faster than this.
    expect(APP_UPDATE_TOUCH_SHIELD_TAIL_MS).toBeLessThanOrEqual(400)
    expect(APP_UPDATE_TOUCH_SHIELD_TAIL_MS).toBeGreaterThanOrEqual(150)
  })
})
