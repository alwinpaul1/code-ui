import { describe, it, expect } from 'vitest'

import { fetchLatestAndroidRelease } from './github-releases'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

function pagedJsonResponse(body: unknown, hasNext: boolean): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...(hasNext
        ? { Link: '<https://api.github.com/repos/alwinpaul1/code-ui/releases?page=2>; rel="next"' }
        : {})
    }
  })
}

describe('fetchLatestAndroidRelease', () => {
  it('picks a newer mobile-android-v tag even when an older tag is listed first', async () => {
    const fetchImpl = async () =>
      jsonResponse([
        {
          tag_name: 'mobile-android-v0.0.37',
          prerelease: true,
          assets: [{ name: 'app-release.apk', browser_download_url: 'https://x/v0.0.37.apk' }]
        },
        {
          tag_name: 'mobile-android-v0.0.42',
          prerelease: true,
          assets: [{ name: 'app-release.apk', browser_download_url: 'https://x/v0.0.42.apk' }]
        }
      ])

    const result = await fetchLatestAndroidRelease({ fetchImpl })
    expect(result?.version).toBe('0.0.42')
    expect(result?.apkUrl).toBe('https://x/v0.0.42.apk')
  })

  it('returns null for a malformed non-array GitHub payload', async () => {
    const fetchImpl = async () => jsonResponse({ message: 'not a release list' })
    await expect(fetchLatestAndroidRelease({ fetchImpl })).resolves.toBeNull()
  })

  it('picks the newest mobile-android-v tag and its apk asset', async () => {
    const fetchImpl = async () =>
      jsonResponse([
        {
          tag_name: 'mobile-android-v0.0.20',
          body: 'Fixes',
          prerelease: true,
          assets: [{ name: 'app-release.apk', browser_download_url: 'https://x/v0.0.20.apk' }]
        },
        {
          tag_name: 'mobile-android-v0.0.19',
          prerelease: true,
          assets: [{ name: 'app-release.apk', browser_download_url: 'https://x/v0.0.19.apk' }]
        }
      ])

    await expect(fetchLatestAndroidRelease({ fetchImpl })).resolves.toEqual({
      version: '0.0.20',
      apkUrl: 'https://x/v0.0.20.apk',
      releaseNotes: 'Fixes'
    })
  })

  it('parses versionCode from the named APK asset', async () => {
    const fetchImpl = async () =>
      jsonResponse([
        {
          tag_name: 'mobile-android-v0.0.20',
          body: 'Fixes',
          prerelease: true,
          assets: [
            {
              name: 'code-ui-android-v0.0.20-3.apk',
              browser_download_url: 'https://x/v0.0.20-3.apk'
            }
          ]
        }
      ])

    await expect(fetchLatestAndroidRelease({ fetchImpl })).resolves.toEqual({
      version: '0.0.20',
      versionCode: 3,
      apkUrl: 'https://x/v0.0.20-3.apk',
      releaseNotes: 'Fixes'
    })
  })

  it('picks the highest versionCode asset for a same-version release', async () => {
    const fetchImpl = async () =>
      jsonResponse([
        {
          tag_name: 'mobile-android-v0.0.20',
          prerelease: true,
          assets: [
            {
              name: 'code-ui-android-v0.0.20-2.apk',
              browser_download_url: 'https://x/v0.0.20-2.apk'
            },
            {
              name: 'code-ui-android-v0.0.20-3.apk',
              browser_download_url: 'https://x/v0.0.20-3.apk'
            }
          ]
        }
      ])

    const result = await fetchLatestAndroidRelease({ fetchImpl })
    expect(result?.versionCode).toBe(3)
    expect(result?.apkUrl).toBe('https://x/v0.0.20-3.apk')
  })

  it('ignores desktop v* tags and non-mobile releases', async () => {
    const fetchImpl = async () =>
      jsonResponse([
        {
          tag_name: 'v1.4.121',
          assets: [{ name: 'Orca.dmg', browser_download_url: 'https://x/orca.dmg' }]
        },
        {
          tag_name: 'mobile-android-v0.0.20',
          prerelease: true,
          assets: [{ name: 'app-release.apk', browser_download_url: 'https://x/v0.0.20.apk' }]
        }
      ])

    const result = await fetchLatestAndroidRelease({ fetchImpl })
    expect(result?.version).toBe('0.0.20')
  })

  it('paginates past desktop releases to find the latest mobile APK', async () => {
    const requestedUrls: string[] = []
    const fetchImpl = async (url: RequestInfo | URL) => {
      requestedUrls.push(String(url))
      if (requestedUrls.length === 1) {
        return pagedJsonResponse(
          [
            {
              tag_name: 'v1.4.121',
              assets: [{ name: 'Orca.dmg', browser_download_url: 'https://x/orca.dmg' }]
            }
          ],
          true
        )
      }
      return pagedJsonResponse(
        [
          {
            tag_name: 'mobile-android-v0.0.20',
            body: 'Android fixes',
            prerelease: true,
            assets: [{ name: 'app-release.apk', browser_download_url: 'https://x/v0.0.20.apk' }]
          }
        ],
        false
      )
    }

    await expect(fetchLatestAndroidRelease({ fetchImpl })).resolves.toEqual({
      version: '0.0.20',
      apkUrl: 'https://x/v0.0.20.apk',
      releaseNotes: 'Android fixes'
    })
    expect(requestedUrls).toEqual([
      'https://api.github.com/repos/alwinpaul1/code-ui/releases?per_page=100&page=1',
      'https://api.github.com/repos/alwinpaul1/code-ui/releases?per_page=100&page=2'
    ])
  })

  it('keeps the best APK found before a later page is rate limited', async () => {
    const fetchImpl = async (_url: RequestInfo | URL, _init?: RequestInit) => {
      if (String(_url).endsWith('page=1')) {
        return pagedJsonResponse(
          [
            {
              tag_name: 'mobile-android-v0.0.20',
              body: 'Android fixes',
              prerelease: true,
              assets: [{ name: 'app-release.apk', browser_download_url: 'https://x/v0.0.20.apk' }]
            }
          ],
          true
        )
      }
      return new Response('rate limited', { status: 403 })
    }

    await expect(fetchLatestAndroidRelease({ fetchImpl })).resolves.toEqual({
      version: '0.0.20',
      apkUrl: 'https://x/v0.0.20.apk',
      releaseNotes: 'Android fixes'
    })
  })

  it('skips mobile tags that have no apk asset', async () => {
    const fetchImpl = async () =>
      jsonResponse([
        {
          tag_name: 'mobile-android-v0.0.21',
          prerelease: true,
          assets: []
        },
        {
          tag_name: 'mobile-android-v0.0.20',
          prerelease: true,
          assets: [{ name: 'app-release.apk', browser_download_url: 'https://x/v0.0.20.apk' }]
        }
      ])

    const result = await fetchLatestAndroidRelease({ fetchImpl })
    expect(result?.version).toBe('0.0.20')
  })

  it('returns null when there is no mobile-android-v release at all', async () => {
    const fetchImpl = async () =>
      jsonResponse([
        { tag_name: 'v1.4.121', assets: [] },
        { tag_name: 'v1.4.120', assets: [] }
      ])
    await expect(fetchLatestAndroidRelease({ fetchImpl })).resolves.toBeNull()
  })

  it('returns null on a non-200 response (rate limited)', async () => {
    const fetchImpl = async () => new Response('rate limited', { status: 403 })
    await expect(fetchLatestAndroidRelease({ fetchImpl })).resolves.toBeNull()
  })

  it('returns null when the network throws', async () => {
    const fetchImpl = async () => {
      throw new Error('offline')
    }
    await expect(fetchLatestAndroidRelease({ fetchImpl })).resolves.toBeNull()
  })
})
