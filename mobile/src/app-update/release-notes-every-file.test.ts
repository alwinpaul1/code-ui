import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { releaseNoteGroups } from './release-notes-groups'
import { releaseBody } from './release-notes-sections'

// Every notes file that has shipped, as the release workflow writes it into the
// GitHub body (with the compare link), must reach the redesigned card with every
// change under the section it was written in, and nothing else in that section
// (2026-10-10 redesign split the notes into groups; 0.9.127 regression hunt).
const NOTES_DIR = join(import.meta.dirname, '../../release-notes')
const files = readdirSync(NOTES_DIR).filter((name) => name.endsWith('.md'))

function sectionsAsWritten(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>()
  let current: string[] | null = null
  for (const line of text.split(/\r?\n/)) {
    const title = /^###\s+(.+?)\s*$/.exec(line)
    if (title) {
      current = []
      sections.set(title[1]!, current)
    } else if (current && line.trim()) {
      current.push(line.trimEnd())
    }
  }
  return sections
}

describe('the update card on every committed release-notes file', () => {
  it.each(files)('%s keeps every change under its own section', (name) => {
    const notes = readFileSync(join(NOTES_DIR, name), 'utf8')
    const body = releaseBody(notes, { tag: 'mobile-android-v9.9.9', previousTag: 'mobile-android-v9.9.8', repo: 'o/r' })
    const groups = releaseNoteGroups(body)
    const written = sectionsAsWritten(notes)
    const drawn = groups.filter((group) => group.section !== null)
    expect(drawn.map((group) => group.section)).toEqual([...written.keys()])
    for (const group of drawn) {
      expect(group.markdown.split('\n').filter((line) => line.trim())).toEqual(written.get(group.section!))
    }
    // Only the compare link is left outside the sections.
    expect(groups.filter((group) => group.section === null).map((group) => group.markdown)).toEqual([
      '[Full changelog](https://github.com/o/r/compare/mobile-android-v9.9.8...mobile-android-v9.9.9)'
    ])
  })
})
