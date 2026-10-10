import { releaseNotesMarkdown } from './release-notes-markdown'
import { RELEASE_NOTE_SECTIONS } from './release-notes-sections'

// The update card draws a release's notes as groups, one per section the
// notes file carries (Features, Improvements, Security & Bug Fixes), each
// with its own marker, instead of one markdown column with bold lines in it
// (2026-10-10 redesign). The words inside a group still go through the
// markdown renderer, reshaped by releaseNotesMarkdown, so code, emphasis and
// links survive.
//
// A body written before the section format ("## What's changed", GitHub's
// generated list) has no section titles; it comes back as one untitled group
// and the card renders it exactly as it did before. So does anything above
// the first section title. The "**Full Changelog**" line GitHub appends goes
// into an untitled group of its own at the end, so it never reads as the last
// change of the last section.

export type ReleaseNoteSection = (typeof RELEASE_NOTE_SECTIONS)[number]

export type ReleaseNoteGroup = {
  /** Null for text that is under no known section title. */
  section: ReleaseNoteSection | null
  /** The group's body, already reshaped for the card. Never empty. */
  markdown: string
}

const SECTION_TITLE = /^#{1,6}\s+(.+?)\s*#*\s*$/
const FULL_CHANGELOG_LINE = /^\*\*full changelog\*\*/i
const FENCE = /^\s*(`{3,}|~{3,})/

function sectionNamed(title: string): ReleaseNoteSection | null {
  const wanted = title.trim().toLowerCase()
  return RELEASE_NOTE_SECTIONS.find((name) => name.toLowerCase() === wanted) ?? null
}

export function releaseNoteGroups(body: string | null | undefined): ReleaseNoteGroup[] {
  if (!body) {
    return []
  }
  const raw: { section: ReleaseNoteSection | null; lines: string[] }[] = []
  const trailer: string[] = []
  let current: { section: ReleaseNoteSection | null; lines: string[] } = { section: null, lines: [] }
  raw.push(current)
  let fence: string | null = null
  for (const line of body.split(/\r?\n/)) {
    if (fence !== null) {
      current.lines.push(line)
      const close = FENCE.exec(line)
      if (close && close[1]![0] === fence[0] && close[1]!.length >= fence.length) {
        fence = null
      }
      continue
    }
    const open = FENCE.exec(line)
    if (open) {
      fence = open[1]!
      current.lines.push(line)
      continue
    }
    const title = SECTION_TITLE.exec(line.trim())
    const section = title ? sectionNamed(title[1]!) : null
    if (section !== null) {
      current = { section, lines: [] }
      raw.push(current)
      continue
    }
    if (FULL_CHANGELOG_LINE.test(line.trim())) {
      trailer.push(line)
      continue
    }
    current.lines.push(line)
  }
  raw.push({ section: null, lines: trailer })
  return raw
    .map((group) => ({ section: group.section, markdown: releaseNotesMarkdown(group.lines.join('\n')) }))
    .filter((group) => group.markdown.length > 0)
}

/** True when the notes carry at least one titled section, so the card draws
 *  section groups rather than one markdown column. */
export function hasReleaseNoteSections(groups: readonly ReleaseNoteGroup[]): boolean {
  return groups.some((group) => group.section !== null)
}
