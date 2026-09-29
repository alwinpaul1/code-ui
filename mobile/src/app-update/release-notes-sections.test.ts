// The update card must tell someone about to install what changed, grouped the way the user asked
// on 2026-09-28: Features, Improvements, Security & Bug Fixes, each a title with its changes under
// it. The body comes from a committed notes file per version (mobile/release-notes/<version>.md),
// checked before a release builds, not from commit subjects: those are written for the repo and
// say nothing about which kind of change a line is.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { releaseNotesMarkdown } from './release-notes-markdown'
import {
  previousNotesVersion,
  RELEASE_NOTE_SECTIONS,
  releaseBody,
  releaseNotesProblems,
  repeatedReleaseNotes
} from './release-notes-sections'

const NOTES_DIR = join(import.meta.dirname, '../../release-notes')

const GOOD = [
  '### Features',
  '- Send screen recordings over 18 MB as frames',
  '',
  '### Improvements',
  '- Light mode on every screen',
  '',
  '### Security & Bug Fixes',
  '- rubyzip 3.7.0',
  '- The chat is drawn again after Files'
].join('\n')

describe('a release notes file', () => {
  it('passes with the three sections in order, each with its changes under it', () => {
    expect(RELEASE_NOTE_SECTIONS).toEqual(['Features', 'Improvements', 'Security & Bug Fixes'])
    expect(releaseNotesProblems(GOOD)).toEqual([])
  })

  it('may leave out a section that has nothing in it', () => {
    expect(releaseNotesProblems('### Security & Bug Fixes\n- A fix')).toEqual([])
  })

  it('refuses an empty file, a section out of order, an unknown title, an empty section and a loose line', () => {
    expect(releaseNotesProblems('')).toEqual(['no section has a change in it'])
    expect(releaseNotesProblems('### Improvements\n- a\n### Features\n- b')).toEqual([
      '"Features" comes after "Improvements"; the order is Features, Improvements, Security & Bug Fixes'
    ])
    expect(releaseNotesProblems("## What's changed\n- a")).toEqual([
      `line 1: "## What's changed" is not one of: ### Features, ### Improvements, ### Security & Bug Fixes`,
      'line 2: "- a" is not under a section title'
    ])
    expect(releaseNotesProblems('### Features\n### Improvements\n- a')).toEqual([
      '"Features" has no changes under it'
    ])
    expect(releaseNotesProblems('### Features\nSome prose\n- a')).toEqual([
      'line 2: "Some prose" is not a "- " change line'
    ])
    expect(releaseNotesProblems('### Features\n- a\n### Features\n- b')).toEqual([
      '"Features" appears twice'
    ])
  })

  it('becomes a release body with the compare link after the sections', () => {
    expect(releaseBody(GOOD, { tag: 'mobile-android-v0.9.101', previousTag: 'mobile-android-v0.9.100', repo: 'o/r' })).toBe(
      `${GOOD}\n\n**Full Changelog**: https://github.com/o/r/compare/mobile-android-v0.9.100...mobile-android-v0.9.101\n`
    )
    expect(releaseBody(GOOD, { tag: 'mobile-android-v0.9.101', previousTag: null, repo: 'o/r' })).toBe(`${GOOD}\n`)
  })

  it('shows each section title on the update card with its changes under it', () => {
    const card = releaseNotesMarkdown(releaseBody(GOOD, { tag: 't2', previousTag: 't1', repo: 'o/r' }))
    expect(card.split('\n')).toEqual([
      '**Features**',
      '- Send screen recordings over 18 MB as frames',
      '',
      '**Improvements**',
      '- Light mode on every screen',
      '',
      '**Security & Bug Fixes**',
      '- rubyzip 3.7.0',
      '- The chat is drawn again after Files',
      '',
      '[Full changelog](https://github.com/o/r/compare/t1...t2)'
    ])
  })
})

// 2026-09-29, the user: "I see the same old features and improvements in
// 0.9.104 it wasnt updating or cleared and rewritten to tell the changelog of
// new version". The card shows the newest release's notes alone, and 0.9.100
// to 0.9.104 each listed everything since 0.9.54, so every update read like
// the one before it.
describe('a release\'s notes against the release before', () => {
  it('names the lines this release repeats from the one before', () => {
    const before = ['### Improvements', '- Light mode on every screen', '- A smaller pill'].join('\n')
    const now = ['### Improvements', '- Light mode on every screen', '', '### Security & Bug Fixes', '- Copy drops the stars'].join('\n')
    expect(repeatedReleaseNotes(now, before)).toEqual(['- Light mode on every screen'])
    expect(repeatedReleaseNotes(GOOD, before)).toEqual(['- Light mode on every screen'])
    expect(repeatedReleaseNotes('### Features\n- New', before)).toEqual([])
  })

  it('finds the release before by version, not by file name order', () => {
    const versions = ['0.9.9', '0.9.100', '0.9.103', '0.9.104', '0.10.0']
    expect(previousNotesVersion('0.9.104', versions)).toBe('0.9.103')
    expect(previousNotesVersion('0.9.100', versions)).toBe('0.9.9')
    expect(previousNotesVersion('0.10.0', versions)).toBe('0.9.104')
    expect(previousNotesVersion('0.9.9', versions)).toBeNull()
    expect(previousNotesVersion('0.9.9', ['0.9.9'])).toBeNull()
    expect(previousNotesVersion('0.9.9', [])).toBeNull()
  })
})

describe('the committed release notes', () => {
  const files = readdirSync(NOTES_DIR).filter((name) => name.endsWith('.md'))
  const app = JSON.parse(readFileSync(join(import.meta.dirname, '../../app.json'), 'utf8')) as {
    expo: { version: string }
  }

  it('include the version app.json ships', () => {
    expect(files).toContain(`${app.expo.version}.md`)
  })

  it('tell what changed in the version app.json ships, not what the release before already said', () => {
    const previous = previousNotesVersion(
      app.expo.version,
      files.map((name) => name.replace(/\.md$/, ''))
    )
    if (previous === null) {
      return
    }
    const read = (version: string) => readFileSync(join(NOTES_DIR, `${version}.md`), 'utf8')
    expect(repeatedReleaseNotes(read(app.expo.version), read(previous))).toEqual([])
  })

  it.each(files)('%s follows the three-section format', (name) => {
    expect(releaseNotesProblems(readFileSync(join(NOTES_DIR, name), 'utf8'))).toEqual([])
  })
})
