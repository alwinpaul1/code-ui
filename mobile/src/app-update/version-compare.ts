// Semver parsing/comparison for the app-update check.
//
// Why: the mobile app ships a strict x.y.z marketing version (see
// scripts/prepare-android-release.mjs `semverPattern`), iTunes Lookup returns
// x.y.z, and latest-version.json stores x.y.z. We only ever compare those, so a
// minimal strict parser is enough — no pre-release/build-metadata complexity,
// which keeps the compare deterministic and the bundle small.

export type Semver = { major: number; minor: number; patch: number }

const STRICT_SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

/** Parse a strict x.y.z version. Returns null for anything else (no throwing). */
export function parseSemver(raw: string | null | undefined): Semver | null {
  if (!raw) {
    return null
  }
  const match = STRICT_SEMVER.exec(raw.trim())
  if (!match) {
    return null
  }
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  ) {
    return null
  }
  return { major, minor, patch }
}

/**
 * Compare two version strings. Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Invalid versions sort before valid ones so a malformed remote value never
 * wins the "latest" comparison.
 */
export function compareVersions(
  a: string | null | undefined,
  b: string | null | undefined
): -1 | 0 | 1 {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa && !pb) {
    return 0
  }
  if (!pa) {
    return -1
  }
  if (!pb) {
    return 1
  }
  if (pa.major !== pb.major) {
    return pa.major < pb.major ? -1 : 1
  }
  if (pa.minor !== pb.minor) {
    return pa.minor < pb.minor ? -1 : 1
  }
  if (pa.patch !== pb.patch) {
    return pa.patch < pb.patch ? -1 : 1
  }
  return 0
}

/** True when `candidate` is strictly newer than `installed`. */
export function isNewerVersion(
  candidate: string | null | undefined,
  installed: string | null | undefined
): boolean {
  return compareVersions(candidate, installed) > 0
}

/**
 * Return the highest valid version among the inputs, or null if none parse.
 * Nullish inputs are ignored so callers can pass optional sources directly.
 */
export function maxSemver(...versions: Array<string | null | undefined>): string | null {
  let best: string | null = null
  for (const v of versions) {
    if (!parseSemver(v)) {
      continue
    }
    if (best === null || compareVersions(v, best) > 0) {
      best = v as string
    }
  }
  return best
}
