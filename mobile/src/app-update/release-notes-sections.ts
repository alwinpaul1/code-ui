/**
 * The release notes format the update card shows (user's rule, 2026-09-28): changes grouped under
 * Features, Improvements, and Security & Bug Fixes, so someone about to install can tell what
 * changed since their build. Each release carries a committed file, mobile/release-notes/<version>.md,
 * of `### <title>` lines with `- ` changes under them, in this order. A section with nothing in it is
 * left out. The card renders each title as a bold line with its changes under it
 * (release-notes-markdown.ts turns a heading into a bold line).
 *
 * scripts/release-notes-body.ts checks the file before a release builds and writes the release body
 * from it; the release workflow and a local release both go through it.
 */

export const RELEASE_NOTE_SECTIONS = ['Features', 'Improvements', 'Security & Bug Fixes'] as const

const TITLE = /^###\s+(.+?)\s*$/
const CHANGE = /^- \S/

/** What is wrong with a notes file, one line each; empty when it is right. */
export function releaseNotesProblems(text: string): string[] {
  const problems: string[] = []
  const seen: string[] = []
  const counts = new Map<string, number>()
  let current: string | null = null
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trimEnd()
    if (line.trim() === '') {
      return
    }
    const where = `line ${index + 1}: "${line}"`
    const title = TITLE.exec(line)
    if (title || line.startsWith('#')) {
      const name = title?.[1]
      if (name === undefined || !(RELEASE_NOTE_SECTIONS as readonly string[]).includes(name)) {
        problems.push(`${where} is not one of: ${RELEASE_NOTE_SECTIONS.map((s) => `### ${s}`).join(', ')}`)
        current = null
        return
      }
      if (seen.includes(name)) {
        problems.push(`"${name}" appears twice`)
      } else {
        const later = seen.find(
          (earlier) =>
            RELEASE_NOTE_SECTIONS.indexOf(earlier as (typeof RELEASE_NOTE_SECTIONS)[number]) >
            RELEASE_NOTE_SECTIONS.indexOf(name as (typeof RELEASE_NOTE_SECTIONS)[number])
        )
        if (later !== undefined) {
          problems.push(`"${name}" comes after "${later}"; the order is ${RELEASE_NOTE_SECTIONS.join(', ')}`)
        }
        seen.push(name)
        counts.set(name, 0)
      }
      current = name
      return
    }
    if (current === null) {
      problems.push(`${where} is not under a section title`)
      return
    }
    if (!CHANGE.test(line)) {
      problems.push(`${where} is not a "- " change line`)
      return
    }
    counts.set(current, (counts.get(current) ?? 0) + 1)
  })
  for (const name of seen) {
    if (counts.get(name) === 0) {
      problems.push(`"${name}" has no changes under it`)
    }
  }
  if (problems.length === 0 && [...counts.values()].every((count) => count === 0)) {
    problems.push('no section has a change in it')
  }
  return problems
}

/** The GitHub release body: the notes as written, then the compare link to the last release. */
export function releaseBody(
  notes: string,
  release: { tag: string; previousTag: string | null; repo: string }
): string {
  const sections = notes.trim()
  if (release.previousTag === null) {
    return `${sections}\n`
  }
  return `${sections}\n\n**Full Changelog**: https://github.com/${release.repo}/compare/${release.previousTag}...${release.tag}\n`
}

/** The change lines of `notes` that `previous` already had, as written. The card shows only the
 *  newest release's notes, so each release lists what changed since the one before it; a line
 *  carried over reads to someone updating as a change they are getting now (2026-09-29: 0.9.100
 *  to 0.9.104 each listed everything since 0.9.54). */
export function repeatedReleaseNotes(notes: string, previous: string): string[] {
  const changes = (text: string) =>
    text
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => CHANGE.test(line))
  const before = new Set(changes(previous))
  return changes(notes).filter((line) => before.has(line))
}

function versionParts(version: string): number[] {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0)
}

function compareVersions(a: string, b: string): number {
  const left = versionParts(a)
  const right = versionParts(b)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) {
      return difference
    }
  }
  return 0
}

/** The newest of `versions` older than `version`, or null when there is none. */
export function previousNotesVersion(version: string, versions: readonly string[]): string | null {
  let previous: string | null = null
  for (const candidate of versions) {
    if (compareVersions(candidate, version) < 0 && (previous === null || compareVersions(candidate, previous) > 0)) {
      previous = candidate
    }
  }
  return previous
}
