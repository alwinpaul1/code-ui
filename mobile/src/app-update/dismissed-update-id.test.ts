import { describe, expect, it } from 'vitest'

import { getUpdateDismissalId, isUpdateDismissed } from './dismissed-update-id'

describe('update dismissal ids', () => {
  it('distinguishes informational and actionable updates for the same version/build', () => {
    expect(
      getUpdateDismissalId({
        version: '0.0.20',
        buildNumber: '5'
      })
    ).toBe('0.0.20:5:informational')
    expect(
      getUpdateDismissalId({
        version: '0.0.20',
        buildNumber: '5',
        updateUrl: 'itms-apps://store'
      })
    ).toBe('0.0.20:5:actionable')
  })

  it('does not let a no-CTA dismissal hide the later actionable update', () => {
    const dismissedUpdateId = getUpdateDismissalId({
      version: '0.0.20',
      buildNumber: '5'
    })

    expect(
      isUpdateDismissed(dismissedUpdateId, {
        version: '0.0.20',
        buildNumber: '5',
        updateUrl: 'itms-apps://store'
      })
    ).toBe(false)
  })

  it('keeps legacy version/build dismissals suppressing only no-CTA updates', () => {
    expect(
      isUpdateDismissed('0.0.20:5', {
        version: '0.0.20',
        buildNumber: '5'
      })
    ).toBe(true)
    expect(
      isUpdateDismissed('0.0.20:5', {
        version: '0.0.20',
        buildNumber: '5',
        updateUrl: 'itms-apps://store'
      })
    ).toBe(false)
  })
})
