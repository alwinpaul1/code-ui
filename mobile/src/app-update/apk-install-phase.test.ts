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

  it('reads a finished download as installing, since the receiver commits it at once', () => {
    for (const phase of ['downloaded', 'installing'] as const) {
      expect(phaseFromUpdaterState({ phase, version: '0.5.7', message: null, pendingUserAction: false })).toBe(
        'installing'
      )
    }
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
