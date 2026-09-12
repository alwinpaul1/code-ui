import { describe, expect, it } from 'vitest'
import { phaseFromUpdaterState } from './apk-install-phase'

// 2026-09-12: the user asked for updates that keep downloading after the app
// is closed and install on their own, like a system update. The native
// updater owns that; these pin how its phases surface in the dialog.
describe('phaseFromUpdaterState', () => {
  it('shows a live download as downloading', () => {
    expect(
      phaseFromUpdaterState({ phase: 'downloading', version: '0.5.7', message: null, pendingUserAction: false })
    ).toBe('downloading')
  })

  // The user's words, 2026-09-12: "when I click update, the download should
  // happen in the background, and even if I close the app, when I open the
  // app it should ask to install that downloaded update." So a finished
  // download waits for the Install button instead of restarting the app.
  it('offers Install for a finished download instead of installing on its own', () => {
    expect(
      phaseFromUpdaterState({ phase: 'downloaded', version: '0.5.9', message: null, pendingUserAction: false })
    ).toBe('ready')
  })

  it('keeps the spinner for a live install, but offers Install again after a cold start', () => {
    const installing = { phase: 'installing' as const, version: '0.5.9', message: null, pendingUserAction: false }
    expect(phaseFromUpdaterState(installing)).toBe('installing')
    expect(phaseFromUpdaterState(installing, { coldStart: true })).toBe('ready')
  })

  it('asks for the person only when Android still wants a tap', () => {
    expect(
      phaseFromUpdaterState({
        phase: 'pending-user-action',
        version: '0.5.7',
        message: null,
        pendingUserAction: true
      })
    ).toBe('ready')
  })

  it('is idle with no native updater at all', () => {
    expect(phaseFromUpdaterState(null)).toBe('idle')
    expect(phaseFromUpdaterState({ phase: 'idle', version: null, message: null, pendingUserAction: false })).toBe(
      'idle'
    )
  })

  it('surfaces a failure', () => {
    expect(
      phaseFromUpdaterState({ phase: 'failed', version: '0.5.7', message: 'Download failed (1006)', pendingUserAction: false })
    ).toBe('failed')
  })
})
