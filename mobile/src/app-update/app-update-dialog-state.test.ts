import { describe, expect, it } from 'vitest'
import { resolveDialogState, type DialogStateInputs } from './app-update-dialog-state-machine'

const base: DialogStateInputs = {
  status: 'idle',
  latestVersion: null,
  userInitiated: false,
  phase: 'idle',
  error: null
}

describe('the update dialog state machine', () => {
  it('shows no dialog while a download runs', () => {
    // 2026-09-14, from the phone: tapping Download must not show a dialog. The
    // download runs in the background; the install screen returns when done.
    expect(resolveDialogState({ ...base, phase: 'downloading' })).toEqual({ kind: 'hidden' })
  })

  it('shows the install screen once the background download finishes', () => {
    expect(resolveDialogState({ ...base, phase: 'ready' })).toEqual({ kind: 'ready' })
    expect(resolveDialogState({ ...base, phase: 'installing' })).toEqual({ kind: 'installing' })
  })

  it('surfaces a failed download as its own dialog', () => {
    expect(resolveDialogState({ ...base, phase: 'failed', error: 'HTTP 500' })).toEqual({
      kind: 'failed',
      error: 'HTTP 500'
    })
  })

  it('keeps the ordinary check states unchanged', () => {
    expect(resolveDialogState({ ...base, status: 'available', latestVersion: '0.5.95' })).toEqual({
      kind: 'available'
    })
    expect(resolveDialogState({ ...base, userInitiated: true, status: 'checking' })).toEqual({
      kind: 'checking'
    })
    expect(resolveDialogState({ ...base, userInitiated: true, status: 'up-to-date' })).toEqual({
      kind: 'up-to-date'
    })
    expect(resolveDialogState(base)).toEqual({ kind: 'hidden' })
  })
})
