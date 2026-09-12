import { describe, expect, it } from 'vitest'
import {
  appUpdateNotificationContent,
  buildAppUpdateNotificationData,
  isAppUpdateNotification,
  planBackgroundUpdateCheck
} from './update-notification'

describe('background update check plan', () => {
  const available = {
    status: 'available' as const,
    latestVersion: '0.5.7',
    updateUrl: 'https://github.com/alwinpaul1/code-ui/releases/download/mobile-android-v0.5.7/code-ui-android-v0.5.7-129.apk'
  }

  it('announces a new release once', () => {
    expect(planBackgroundUpdateCheck({ enabled: true, result: available, lastNotifiedVersion: null })).toEqual({
      action: 'notify',
      version: '0.5.7'
    })
    expect(
      planBackgroundUpdateCheck({ enabled: true, result: available, lastNotifiedVersion: '0.5.7' })
    ).toEqual({ action: 'skip', reason: 'already-notified' })
  })

  it('announces the next release after an earlier one was announced', () => {
    expect(
      planBackgroundUpdateCheck({ enabled: true, result: available, lastNotifiedVersion: '0.5.6' })
    ).toEqual({ action: 'notify', version: '0.5.7' })
  })

  it('does nothing when switched off, up to date, or the check failed', () => {
    expect(planBackgroundUpdateCheck({ enabled: false, result: available, lastNotifiedVersion: null })).toEqual({
      action: 'skip',
      reason: 'disabled'
    })
    expect(
      planBackgroundUpdateCheck({ enabled: true, result: { status: 'up-to-date' }, lastNotifiedVersion: null })
    ).toEqual({ action: 'skip', reason: 'not-available' })
    expect(
      planBackgroundUpdateCheck({ enabled: true, result: { status: 'error' }, lastNotifiedVersion: null })
    ).toEqual({ action: 'skip', reason: 'not-available' })
  })
})

describe('update notification', () => {
  it('round-trips its data and is told apart from a desktop notification', () => {
    const data = buildAppUpdateNotificationData('0.5.7')
    expect(isAppUpdateNotification(data)).toBe(true)
    expect(isAppUpdateNotification({ source: 'agent-task-complete', hostId: 'h1' })).toBe(false)
    expect(isAppUpdateNotification(null)).toBe(false)
  })

  it('names the version in the title', () => {
    expect(appUpdateNotificationContent('0.5.7')).toEqual({
      title: 'Code UI 0.5.7 is available',
      body: 'Tap to see what is new and install it.'
    })
  })
})
