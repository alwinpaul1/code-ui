import { z } from 'zod'

import { compareVersions } from './version-compare'

// Reads the newest Android mobile release from the GitHub Releases API.
//
// Why a dedicated source: Code UI is distributed as an APK on GitHub Releases
// (tagged `mobile-android-v<x.y.z>` — see .github/workflows/mobile-android-release.yml),
// NOT through Google Play. So the only
// authoritative "latest Android version" is the newest mobile-android-v tag,
// and the only downloadable artifact is that release's `.apk` asset.
//
// Filtering by the mobile-android-v prefix keeps any other tag on the repo
// from being misread as a mobile update.
//
// Rate-limit trade-off: the calls are unauthenticated, so they share GitHub's
// 60-req/hour-per-IP bucket. We fetch 100 releases per page and cap pagination
// so desktop-release churn does not hide mobile APKs without making the app do
// an unbounded unauthenticated API walk.

const REPO_RELEASES_URL = 'https://api.github.com/repos/alwinpaul1/code-ui/releases'
const MOBILE_TAG_PREFIX = 'mobile-android-v'
const RELEASES_PER_PAGE = 100
// Why: 1,000 repo releases covers long desktop-only gaps while bounding
// unauthenticated requests on shared mobile networks.
const MAX_RELEASE_PAGES = 10

const ReleaseAsset = z.object({
  name: z.string(),
  browser_download_url: z.url()
})

const GithubRelease = z.object({
  tag_name: z.string(),
  html_url: z.string().optional().catch(undefined),
  // Why: included so we can surface changelog text in the banner.
  body: z.string().optional().catch(''),
  // Why: drafts are never returned by the public API, but we guard anyway so a
  // draft leaked via an authenticated call in future can't be picked.
  draft: z.boolean().optional().catch(false),
  prerelease: z.boolean().optional().catch(false),
  assets: z.array(ReleaseAsset).catch([])
})

const GithubReleasesResponse = z.array(GithubRelease)

export type AndroidReleaseInfo = {
  version: string
  /** Monotonic Android native build id parsed from the APK asset name when available. */
  versionCode?: number
  /** Direct HTTPS URL to the .apk asset hosted on the GitHub release. */
  apkUrl: string
  /** Optional changelog body from the release. */
  releaseNotes?: string
  /** Web page of the release on GitHub. */
  releaseUrl?: string
}

type AndroidApkAsset = {
  apkUrl: string
  versionCode?: number
}

function stripMobileTagPrefix(tagName: string): string {
  return tagName.startsWith(MOBILE_TAG_PREFIX) ? tagName.slice(MOBILE_TAG_PREFIX.length) : ''
}

function parseVersionCodeFromAssetName(name: string): number | null {
  const match = /-(\d+)\.apk$/i.exec(name)
  if (!match) {
    return null
  }
  const parsed = Number(match[1])
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function compareVersionCodes(
  a: number | null | undefined,
  b: number | null | undefined
): -1 | 0 | 1 {
  if (a === b) {
    return 0
  }
  if (a === null || a === undefined) {
    return -1
  }
  if (b === null || b === undefined) {
    return 1
  }
  return a < b ? -1 : 1
}

function pickApkAsset(
  assets: Array<{ name: string; browser_download_url: string }>
): AndroidApkAsset | null {
  let best: AndroidApkAsset | null = null
  for (const asset of assets) {
    if (!asset.name.toLowerCase().endsWith('.apk')) {
      continue
    }
    const versionCode = parseVersionCodeFromAssetName(asset.name) ?? undefined
    const candidate = { apkUrl: asset.browser_download_url, versionCode }
    if (!best || compareVersionCodes(candidate.versionCode, best.versionCode) > 0) {
      best = candidate
    }
  }
  return best
}

function releasesPageUrl(page: number): string {
  return `${REPO_RELEASES_URL}?per_page=${RELEASES_PER_PAGE}&page=${page}`
}

function hasNextPage(response: Response): boolean {
  return response.headers.get('link')?.includes('rel="next"') ?? false
}

/**
 * Resolve the newest Code UI Android release and its APK download URL.
 * Returns null when no page resolves a mobile-android-v release with an APK.
 * Later-page failures keep the best candidate already found; callers treat null
 * as "no Android update signal".
 */
export async function fetchLatestAndroidRelease(
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<AndroidReleaseInfo | null> {
  const fetchImpl = options.fetchImpl ?? fetch
  let best: AndroidReleaseInfo | null = null
  try {
    // Why: the API returns newest-first, but we re-rank by parsed semver so a
    // backfilled older tag can't shadow the true latest. Drafts are skipped
    // defensively; prereleases are KEPT because Android ships as prerelease.
    for (let page = 1; page <= MAX_RELEASE_PAGES; page += 1) {
      const response = await fetchImpl(releasesPageUrl(page), {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'code-ui-mobile' },
        signal: options.signal
      })
      if (!response.ok) {
        // Why: GitHub can rate-limit a later page after page 1 already found a
        // valid APK. Keep that signal instead of turning a partial success into
        // "no update".
        console.log('[app-update] releases request failed', { page, status: response.status })
        return best
      }
      const releases = GithubReleasesResponse.parse(await response.json())

      for (const release of releases) {
        if (release.draft) {
          continue
        }
        const version = stripMobileTagPrefix(release.tag_name)
        if (!version) {
          // Not a mobile-android-v tag (e.g. desktop v1.4.x) — skip.
          continue
        }
        const apk = pickApkAsset(release.assets)
        if (!apk) {
          // A mobile tag with no APK yet (failed/cancelled upload) is useless.
          continue
        }
        const versionOrder = best === null ? 1 : compareVersions(version, best.version)
        const buildOrder =
          best === null || versionOrder !== 0
            ? 0
            : compareVersionCodes(apk.versionCode, best.versionCode)
        if (best === null || versionOrder > 0 || buildOrder > 0) {
          best = {
            version,
            ...(apk.versionCode ? { versionCode: apk.versionCode } : {}),
            apkUrl: apk.apkUrl,
            releaseNotes: release.body || undefined,
            releaseUrl: release.html_url || undefined
          }
        }
      }

      if (!hasNextPage(response)) {
        break
      }
    }
    return best
  } catch (error) {
    // Why: best-effort — rate limits, offline, or a shape change must not break
    // the Home screen. If a previous page already found a valid APK, keep it.
    console.log('[app-update] releases lookup failed', String(error))
    return best
  }
}
