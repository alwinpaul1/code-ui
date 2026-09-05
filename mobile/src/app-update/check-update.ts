import { fetchLatestAndroidRelease, type AndroidReleaseInfo } from './github-releases'
import { compareVersions, parseSemver } from './version-compare'

// Orchestrates the version check.
//
// Pure decision logic lives in evaluateUpdate(); the network branching lives in
// performUpdateCheck(). Keeping them split lets the decision table be
// unit-tested without touching the network. Code UI ships Android only, as an
// APK on GitHub Releases; iOS has no release channel yet, so it resolves to
// 'error' (silent) rather than pretending to be up to date.

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'up-to-date' | 'error'

export type UpdateCheckResult =
  | { status: 'up-to-date' }
  | {
      status: 'available'
      latestVersion: string
      latestBuildNumber?: string
      releaseNotes?: string
      updateUrl?: string
      /** Web page of the release, for "Read the full release notes". */
      releaseUrl?: string
    }
  | { status: 'error' }

export type UpdateCandidate = {
  version: string
  buildNumber?: string | number | null
  releaseNotes?: string
  updateUrl?: string
  releaseUrl?: string
}

export type UpdateSources = {
  android?: () => Promise<AndroidReleaseInfo | null>
}

function parseBuildNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) {
    return null
  }
  const value = String(raw).trim()
  if (!/^\d+$/.test(value)) {
    return null
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function formatBuildNumber(raw: string | number | null | undefined): string | undefined {
  const parsed = parseBuildNumber(raw)
  return parsed === null ? undefined : String(parsed)
}

function compareBuildNumbers(
  a: string | number | null | undefined,
  b: string | number | null | undefined
): -1 | 0 | 1 {
  const parsedA = parseBuildNumber(a)
  const parsedB = parseBuildNumber(b)
  if (parsedA === null && parsedB === null) {
    return 0
  }
  if (parsedA === null) {
    return -1
  }
  if (parsedB === null) {
    return 1
  }
  if (parsedA === parsedB) {
    return 0
  }
  return parsedA < parsedB ? -1 : 1
}

function compareCandidates(a: UpdateCandidate, b: UpdateCandidate): -1 | 0 | 1 {
  const versionOrder = compareVersions(a.version, b.version)
  if (versionOrder !== 0) {
    return versionOrder
  }
  return compareBuildNumbers(a.buildNumber, b.buildNumber)
}

function isCandidateNewerThanInstalled(input: {
  candidate: UpdateCandidate
  installedVersion: string
  installedBuildNumber?: string | number | null
}): boolean {
  const versionOrder = compareVersions(input.candidate.version, input.installedVersion)
  if (versionOrder !== 0) {
    return versionOrder > 0
  }
  return compareBuildNumbers(input.candidate.buildNumber, input.installedBuildNumber) > 0
}

function pickLatestCandidate(candidates: UpdateCandidate[]): UpdateCandidate | null {
  let best: UpdateCandidate | null = null
  for (const candidate of candidates) {
    if (!parseSemver(candidate.version)) {
      continue
    }
    if (!best || compareCandidates(candidate, best) > 0) {
      best = candidate
    }
  }
  return best
}

/**
 * Decide the update state purely from the installed version and a set of remote
 * candidates. The newest valid candidate wins; equal marketing versions use
 * the native build number as a tie-breaker for TestFlight reuse of x.y.z.
 */
export function evaluateUpdate(input: {
  installedVersion: string
  installedBuildNumber?: string | number | null
  candidates: UpdateCandidate[]
}): UpdateCheckResult {
  const latest = pickLatestCandidate(input.candidates)

  if (!latest) {
    // No source produced a usable version — nothing actionable for the user.
    return { status: 'error' }
  }
  if (
    !isCandidateNewerThanInstalled({
      candidate: latest,
      installedVersion: input.installedVersion,
      installedBuildNumber: input.installedBuildNumber
    })
  ) {
    return { status: 'up-to-date' }
  }

  const winners = input.candidates.filter((candidate) => compareCandidates(candidate, latest) === 0)
  // Why: once the marketing version has moved past what's installed, prefer any
  // same-version update URL over the exact build-number winner.
  const urlCandidates =
    compareVersions(latest.version, input.installedVersion) > 0
      ? input.candidates.filter(
          (candidate) => compareVersions(candidate.version, latest.version) === 0
        )
      : winners
  const releaseNotes = winners.map((w) => w.releaseNotes).find((n): n is string => Boolean(n))
  const updateUrl = urlCandidates.map((w) => w.updateUrl).find((u): u is string => Boolean(u))
  const releaseUrl = winners.map((w) => w.releaseUrl).find((u): u is string => Boolean(u))
  const latestBuildNumber = formatBuildNumber(latest.buildNumber)

  return {
    status: 'available',
    latestVersion: latest.version,
    ...(latestBuildNumber ? { latestBuildNumber } : {}),
    ...(releaseNotes ? { releaseNotes } : {}),
    ...(updateUrl ? { updateUrl } : {}),
    ...(releaseUrl ? { releaseUrl } : {})
  }
}

/**
 * Throttle gate: decide whether enough time has passed since the last check to
 * run another. A missing lastCheckAt (never checked) always allows the check.
 */
export function shouldCheck(input: {
  now: number
  lastCheckAtMs: number | null
  intervalMs: number
}): boolean {
  if (input.lastCheckAtMs === null) {
    return true
  }
  return input.now - input.lastCheckAtMs >= input.intervalMs
}

/**
 * Decide whether the store should start a network check. Cold-start idle state
 * must bypass the persisted throttle because no available/up-to-date result has
 * been hydrated into memory.
 */
export function shouldRunUpdateCheck(input: {
  force?: boolean
  hasInMemoryResult: boolean
  now: number
  lastCheckAtMs: number | null
  intervalMs: number
}): boolean {
  if (input.force || !input.hasInMemoryResult) {
    return true
  }
  return shouldCheck({
    now: input.now,
    lastCheckAtMs: input.lastCheckAtMs,
    intervalMs: input.intervalMs
  })
}

/**
 * Run the check. Android reads the newest mobile-android-v GitHub release; iOS
 * has no source yet and resolves to 'error'. Sources are injectable for tests.
 */
export async function performUpdateCheck(input: {
  platform: 'ios' | 'android'
  installedVersion: string
  installedBuildNumber?: string | number | null
  signal?: AbortSignal
  sources?: UpdateSources
}): Promise<UpdateCheckResult> {
  const s = input.sources ?? {}
  const signal = input.signal
  const candidates: UpdateCandidate[] = []

  if (input.platform === 'android') {
    const android = s.android ?? (() => fetchLatestAndroidRelease({ signal }))
    const release = await android().catch(() => null)
    if (release) {
      candidates.push({
        version: release.version,
        buildNumber: release.versionCode,
        releaseNotes: release.releaseNotes,
        updateUrl: release.apkUrl,
        releaseUrl: release.releaseUrl
      })
    }
  }

  return evaluateUpdate({
    installedVersion: input.installedVersion,
    installedBuildNumber: input.installedBuildNumber,
    candidates
  })
}
