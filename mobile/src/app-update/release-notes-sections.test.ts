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
  RELEASE_NOTE_SECTIONS,
  releaseBody,
  releaseNotesProblems
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

describe('the committed release notes', () => {
  const files = readdirSync(NOTES_DIR).filter((name) => name.endsWith('.md'))

  it('include the version app.json ships', () => {
    const app = JSON.parse(readFileSync(join(import.meta.dirname, '../../app.json'), 'utf8')) as {
      expo: { version: string }
    }
    expect(files).toContain(`${app.expo.version}.md`)
  })

  it.each(files)('%s follows the three-section format', (name) => {
    expect(releaseNotesProblems(readFileSync(join(NOTES_DIR, name), 'utf8'))).toEqual([])
  })
})
