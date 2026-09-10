import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  APP_UPDATE_TOUCH_SHIELD_TAIL_MS,
  UPDATE_DIALOG_TOUCH_SHIELD_FILL,
  nextTouchShieldState,
  pointerBlockForUpdateDialog,
  updateDialogShowsCard,
  updateDialogTouchShieldStyle
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

describe('the leftover press after Done on a Galaxy S23', () => {
  it('covers the whole dialog window while the card fades, so the repository row cannot take the press', () => {
    // Recorded 2026-09-10 on 0.3.0, Galaxy S23, holding Done for 700 ms. As
    // the dialog faded, alwinpaul1/code-ui lit its pressed state. The card's
    // opacity animation stops Android hit-testing that window, and an empty
    // View in the activity behind is not clickable, so the row under the
    // finger received the rest of the gesture.
    expect(
      pointerBlockForUpdateDialog({ dialogVisible: false, shielded: true })
    ).toBe('full')
  })

  it('only dims the backdrop while the dialog is up, so Done still works', () => {
    expect(
      pointerBlockForUpdateDialog({ dialogVisible: true, shielded: true })
    ).toBe('backdrop')
  })

  it('paints a 1% fill so Android treats the shield as a click target', () => {
    // Fully transparent views are skipped by Android hit-testing, which is
    // how the leftover Done press reached alwinpaul1/code-ui on 0.3.0.
    expect(updateDialogTouchShieldStyle().backgroundColor).toBe(UPDATE_DIALOG_TOUCH_SHIELD_FILL)
    expect(UPDATE_DIALOG_TOUCH_SHIELD_FILL).not.toBe('transparent')
  })

  it('hides the card as soon as Done closes, so it cannot sit on alwinpaul1/code-ui while fading', () => {
    // Recorded 2026-09-10 on 0.3.2, Galaxy S23. Holding Done for 700 ms left
    // the rounded card over the github row as it faded. That is the "click"
    // on alwinpaul1/code-ui. The shield tail may keep eating presses; the
    // card must already be gone.
    expect(updateDialogShowsCard(false)).toBe(false)
    expect(updateDialogShowsCard(true)).toBe(true)
    const source = readFileSync(new URL('./AppUpdateDialog.tsx', import.meta.url), 'utf8')
    expect(source).toContain('showCard ?')
    expect(source).toContain('updateDialogShowsCard')
  })

  it('does not fade the window-filling overlay, so Done cannot land on alwinpaul1/code-ui', () => {
    // Recorded 2026-09-10 on a Galaxy S23. The dimmer stayed opaque, but the
    // flex:1 wrapper around the card still bound opacity to the dismiss
    // animation. Native-driver opacity < 1 on a view that fills the Modal
    // makes Android skip that window, and the leftover Done press lights the
    // github row underneath.
    const source = readFileSync(new URL('./AppUpdateDialog.tsx', import.meta.url), 'utf8')
    const wrapperStart = source.indexOf(
      "pointerEvents={pointerBlock === 'full' ? 'none' : 'box-none'}"
    )
    expect(wrapperStart).toBeGreaterThan(0)
    const styleStart = source.indexOf('style={{', wrapperStart)
    const wrapperStyle = source.slice(styleStart, source.indexOf('}}', styleStart))
    expect(wrapperStyle).toContain('flex: 1')
    expect(wrapperStyle).not.toContain('opacity: reveal')
  })
})
