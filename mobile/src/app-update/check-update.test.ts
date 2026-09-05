import { describe, it, expect } from 'vitest'

import {
  evaluateUpdate,
  shouldCheck,
  shouldRunUpdateCheck,
  performUpdateCheck
} from './check-update'
import type { AndroidReleaseInfo } from './github-releases'

describe('evaluateUpdate', () => {
  it('returns available when a candidate is strictly newer', () => {
    const result = evaluateUpdate({
      installedVersion: '0.0.20',
      candidates: [{ version: '0.0.21', updateUrl: 'https://x/a.apk' }]
    })
    expect(result).toEqual({
      status: 'available',
      latestVersion: '0.0.21',
      updateUrl: 'https://x/a.apk'
    })
  })

  it('allows an available update without an action url', () => {
    const result = evaluateUpdate({
      installedVersion: '0.0.20',
      candidates: [{ version: '0.0.21' }]
    })
    expect(result).toEqual({
      status: 'available',
      latestVersion: '0.0.21'
    })
  })

  it('picks the max version across candidates', () => {
    const result = evaluateUpdate({
      installedVersion: '0.0.20',
      candidates: [
        { version: '0.0.20' }, // itunes production
        { version: '0.0.22', updateUrl: 'itms-apps://store' } // manifest beta
      ]
    })
    expect(result).toEqual({
      status: 'available',
      latestVersion: '0.0.22',
      updateUrl: 'itms-apps://store'
    })
  })

  it('uses build number as a same-version tie-breaker', () => {
    const result = evaluateUpdate({
      installedVersion: '0.0.20',
      installedBuildNumber: '3',
      candidates: [{ version: '0.0.20', buildNumber: '4', releaseNotes: 'Beta build' }]
    })

    expect(result).toEqual({
      status: 'available',
      latestVersion: '0.0.20',
      latestBuildNumber: '4',
      releaseNotes: 'Beta build'
    })
  })

  it('keeps a same-version App Store url when installed marketing version is older', () => {
    const result = evaluateUpdate({
      installedVersion: '0.0.19',
      candidates: [
        { version: '0.0.20', updateUrl: 'itms-apps://store' },
        { version: '0.0.20', buildNumber: '5', releaseNotes: 'Beta build' }
      ]
    })

    expect(result).toEqual({
      status: 'available',
      latestVersion: '0.0.20',
      latestBuildNumber: '5',
      releaseNotes: 'Beta build',
      updateUrl: 'itms-apps://store'
    })
  })

  it('returns up-to-date when same-version build is not newer', () => {
    expect(
      evaluateUpdate({
        installedVersion: '0.0.20',
        installedBuildNumber: '4',
        candidates: [{ version: '0.0.20', buildNumber: '4' }]
      })
    ).toEqual({ status: 'up-to-date' })
  })

  it('merges release notes from the winning candidate', () => {
    const result = evaluateUpdate({
      installedVersion: '0.0.20',
      candidates: [{ version: '0.0.21', releaseNotes: 'New!', updateUrl: 'u' }]
    })
    expect(result.status).toBe('available')
    if (result.status === 'available') {
      expect(result.releaseNotes).toBe('New!')
    }
  })

  it('returns up-to-date when latest is not newer', () => {
    expect(
      evaluateUpdate({
        installedVersion: '0.0.21',
        candidates: [{ version: '0.0.21', updateUrl: 'u' }]
      })
    ).toEqual({ status: 'up-to-date' })
  })

  it('returns up-to-date when the candidate tag is older than installed', () => {
    expect(
      evaluateUpdate({
        installedVersion: '0.0.42',
        installedBuildNumber: '11',
        candidates: [{ version: '0.0.37', updateUrl: 'https://x/0.0.37.apk' }]
      })
    ).toEqual({ status: 'up-to-date' })
  })

  it('returns error when no candidate resolves a version', () => {
    expect(evaluateUpdate({ installedVersion: '0.0.20', candidates: [] })).toEqual({
      status: 'error'
    })
  })

  it('returns error when no candidate has a valid semver version', () => {
    expect(
      evaluateUpdate({
        installedVersion: '0.0.20',
        candidates: [{ version: 'bad' }]
      })
    ).toEqual({ status: 'error' })
  })
})

describe('shouldCheck', () => {
  it('allows the first ever check', () => {
    expect(shouldCheck({ now: 1000, lastCheckAtMs: null, intervalMs: 100 })).toBe(true)
  })

  it('blocks re-checking inside the interval', () => {
    expect(shouldCheck({ now: 150, lastCheckAtMs: 100, intervalMs: 100 })).toBe(false)
  })

  it('allows re-checking once the interval has elapsed', () => {
    expect(shouldCheck({ now: 201, lastCheckAtMs: 100, intervalMs: 100 })).toBe(true)
  })
})

describe('shouldRunUpdateCheck', () => {
  it('bypasses the persisted throttle when no result is in memory', () => {
    expect(
      shouldRunUpdateCheck({
        hasInMemoryResult: false,
        now: 150,
        lastCheckAtMs: 100,
        intervalMs: 1000
      })
    ).toBe(true)
  })

  it('honors the persisted throttle when a result is already in memory', () => {
    expect(
      shouldRunUpdateCheck({
        hasInMemoryResult: true,
        now: 150,
        lastCheckAtMs: 100,
        intervalMs: 1000
      })
    ).toBe(false)
  })

  it('allows force checks regardless of throttle state', () => {
    expect(
      shouldRunUpdateCheck({
        force: true,
        hasInMemoryResult: true,
        now: 150,
        lastCheckAtMs: 100,
        intervalMs: 1000
      })
    ).toBe(true)
  })
})

describe('performUpdateCheck', () => {
  it('iOS resolves to error until an iOS release channel exists', async () => {
    const result = await performUpdateCheck({
      platform: 'ios',
      installedVersion: '0.0.20',
      sources: { android: async () => ({ version: '9.9.9', apkUrl: 'https://x/apk' }) }
    })
    expect(result).toEqual({ status: 'error' })
  })

  it('Android reports available when the newest release is newer', async () => {
    const android = async (): Promise<AndroidReleaseInfo | null> => ({
      version: '0.0.21',
      apkUrl: 'https://x/a.apk'
    })
    const result = await performUpdateCheck({
      platform: 'android',
      installedVersion: '0.0.20',
      sources: { android }
    })
    expect(result).toEqual({
      status: 'available',
      latestVersion: '0.0.21',
      updateUrl: 'https://x/a.apk'
    })
  })

  it('Android reports available when the same version has a newer versionCode', async () => {
    const android = async (): Promise<AndroidReleaseInfo | null> => ({
      version: '0.0.20',
      versionCode: 3,
      apkUrl: 'https://x/a.apk'
    })
    const result = await performUpdateCheck({
      platform: 'android',
      installedVersion: '0.0.20',
      installedBuildNumber: '2',
      sources: { android }
    })
    expect(result).toEqual({
      status: 'available',
      latestVersion: '0.0.20',
      latestBuildNumber: '3',
      updateUrl: 'https://x/a.apk'
    })
  })

  it('Android reports error when no release resolves', async () => {
    const android = async (): Promise<AndroidReleaseInfo | null> => null
    const result = await performUpdateCheck({
      platform: 'android',
      installedVersion: '0.0.20',
      sources: { android }
    })
    expect(result).toEqual({ status: 'error' })
  })

  it('Android survives a throwing source (treated as null)', async () => {
    const android = async (): Promise<AndroidReleaseInfo | null> => {
      throw new Error('boom')
    }
    const result = await performUpdateCheck({
      platform: 'android',
      installedVersion: '0.0.20',
      sources: { android }
    })
    expect(result).toEqual({ status: 'error' })
  })
})
