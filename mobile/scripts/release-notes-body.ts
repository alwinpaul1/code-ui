// Checks this version's release notes (mobile/release-notes/<version>.md) and writes the GitHub
// release body from them. The update card shows that body grouped under Features, Improvements,
// and Security & Bug Fixes (src/app-update/release-notes-sections.ts), so a release without a
// well-formed file refuses to build rather than ship an ungrouped or empty card.
//
//   tsx scripts/release-notes-body.ts --check
//   tsx scripts/release-notes-body.ts --tag <tag> --previous <tag|""> --repo <owner/repo> --out <file>

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  previousNotesVersion,
  releaseBody,
  releaseNotesProblems,
  repeatedReleaseNotes
} from '../src/app-update/release-notes-sections'

const MOBILE = join(import.meta.dirname, '..')

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? null : (process.argv[index + 1] ?? '')
}

const version = (JSON.parse(readFileSync(join(MOBILE, 'app.json'), 'utf8')) as { expo: { version: string } })
  .expo.version
const file = join(MOBILE, 'release-notes', `${version}.md`)
if (!existsSync(file)) {
  console.error(
    `::error::No release notes for ${version}: add mobile/release-notes/${version}.md with ### Features, ### Improvements and ### Security & Bug Fixes sections of "- " lines.`
  )
  process.exit(1)
}
const notes = readFileSync(file, 'utf8')
const problems = releaseNotesProblems(notes)
// The card shows only the newest release's notes, so they say what changed since the one before.
const priorVersion = previousNotesVersion(
  version,
  readdirSync(join(MOBILE, 'release-notes'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.replace(/\.md$/, ''))
)
if (priorVersion !== null) {
  const prior = readFileSync(join(MOBILE, 'release-notes', `${priorVersion}.md`), 'utf8')
  for (const line of repeatedReleaseNotes(notes, prior)) {
    problems.push(`"${line}" is already in ${priorVersion}'s notes; list only what changed since ${priorVersion}`)
  }
}
if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`::error file=mobile/release-notes/${version}.md::${problem}`)
  }
  process.exit(1)
}
if (process.argv.includes('--check')) {
  console.log(`Release notes for ${version} are well formed.`)
  process.exit(0)
}
const tag = arg('tag')
const repo = arg('repo')
const out = arg('out')
if (!tag || !repo || !out) {
  console.error('::error::--tag, --repo and --out are required unless --check is given')
  process.exit(1)
}
const previous = arg('previous')
const body = releaseBody(notes, { tag, previousTag: previous ? previous : null, repo })
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, body)
console.log(body)
