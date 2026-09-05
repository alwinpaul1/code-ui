import { describe, it, expect } from 'vitest'

import { performUpdateCheck } from './check-update'
import { fetchLatestAndroidRelease } from './github-releases'

// Drives the shipped Android path: GitHub payload → fetchLatestAndroidRelease
// (select) → performUpdateCheck (compare). The fetch is injected; the
// compare/select functions are the real ones.

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

function androidFromPayload(body: unknown) {
  return () =>
    fetchLatestAndroidRelease({
      fetchImpl: async () => jsonResponse(body)
    })
}

const DESKTOP_RELEASE = {
  tag_name: 'v1.4.182',
  assets: [{ name: 'Orca.dmg', browser_download_url: 'https://x/Orca.dmg' }]
}

function mobileApk(version: string, apkUrl: string, assetName = 'app-release.apk') {
  return {
    tag_name: `mobile-android-v${version}`,
    prerelease: true,
    assets: [{ name: assetName, browser_download_url: apkUrl }]
  }
}

describe('Android update path (select + compare)', () => {
  it('reports available for a newer mobile-android-v tag', async () => {
    const apkUrl = 'https://github.com/alwinpaul1/code-ui/releases/download/mobile-android-v0.0.43/app-release.apk'
    const result = await performUpdateCheck({
      platform: 'android',
      installedVersion: '0.0.42',
      installedBuildNumber: '11',
      sources: {
        android: androidFromPayload([DESKTOP_RELEASE, mobileApk('0.0.43', apkUrl)])
      }
    })

    expect(result.status).toBe('available')
    if (result.status !== 'available') {
      throw new Error(`expected available, got ${result.status}`)
    }
    expect(result.latestVersion).toBe('0.0.43')
    expect(result.updateUrl).toBe(apkUrl)
  })

  it('reports up-to-date for the same marketing version and versionCode', async () => {
    const result = await performUpdateCheck({
      platform: 'android',
      installedVersion: '0.0.42',
      installedBuildNumber: '11',
      sources: {
        android: androidFromPayload([
          mobileApk(
            '0.0.42',
            'https://x/v0.0.42-11.apk',
            'code-ui-android-v0.0.42-11.apk'
          )
        ])
      }
    })
    expect(result).toEqual({ status: 'up-to-date' })
  })

  it('reports up-to-date when the newest mobile tag is older than installed', async () => {
    const result = await performUpdateCheck({
      platform: 'android',
      installedVersion: '0.0.42',
      installedBuildNumber: '11',
      sources: {
        android: androidFromPayload([mobileApk('0.0.37', 'https://x/v0.0.37.apk')])
      }
    })
    expect(result).toEqual({ status: 'up-to-date' })
  })

  it('reports available for the same marketing version with a higher versionCode', async () => {
    const apkUrl = 'https://x/v0.0.42-12.apk'
    const result = await performUpdateCheck({
      platform: 'android',
      installedVersion: '0.0.42',
      installedBuildNumber: '11',
      sources: {
        android: androidFromPayload([
          mobileApk('0.0.42', apkUrl, 'code-ui-android-v0.0.42-12.apk')
        ])
      }
    })

    expect(result.status).toBe('available')
    if (result.status !== 'available') {
      throw new Error(`expected available, got ${result.status}`)
    }
    expect(result.latestVersion).toBe('0.0.42')
    expect(result.latestBuildNumber).toBe('12')
    expect(result.updateUrl).toBe(apkUrl)
  })

  it('reports error for a malformed non-Android release payload', async () => {
    const result = await performUpdateCheck({
      platform: 'android',
      installedVersion: '0.0.42',
      installedBuildNumber: '11',
      sources: {
        android: androidFromPayload({ message: 'Not Found', documentation_url: 'https://docs.github.com' })
      }
    })
    expect(result).toEqual({ status: 'error' })
  })
})
