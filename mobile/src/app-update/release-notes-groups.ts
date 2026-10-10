import { joinReshapedReleaseNotes, reshapeReleaseNoteLines } from './release-notes-markdown'
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
//
// The split runs on the reshaper's OWN output, not on the raw body: a title
// inside an HTML comment, a fenced block or an indented code line is not a
// heading to the reshaper, so it is not a section here either. Splitting the
// raw lines first drew a commented-out draft as a section and moved the next
// change into it (review, 2026-10-10).

export type ReleaseNoteSection = (typeof RELEASE_NOTE_SECTIONS)[number]

export type ReleaseNoteGroup = {
  /** Null for text that is under no known section title. */
  section: ReleaseNoteSection | null
  /** The group's body, already reshaped for the card. Never empty. */
  markdown: string
}

// The reshaper's link for GitHub's "**Full Changelog**: <url>" line, or the
// line as written when the URL has parentheses and it left it alone.
const FULL_CHANGELOG_LINE = /^(\[Full changelog\]\(|\*\*full changelog\*\*)/i

function sectionNamed(title: string): ReleaseNoteSection | null {
  const wanted = title.trim().toLowerCase()
  return RELEASE_NOTE_SECTIONS.find((name) => name.toLowerCase() === wanted) ?? null
}

export function releaseNoteGroups(body: string | null | undefined): ReleaseNoteGroup[] {
  const groups: { section: ReleaseNoteSection | null; lines: string[] }[] = []
  const trailer: string[] = []
  let current: { section: ReleaseNoteSection | null; lines: string[] } = { section: null, lines: [] }
  groups.push(current)
  for (const line of reshapeReleaseNoteLines(body)) {
    const section = line.heading === null ? null : sectionNamed(line.heading)
    if (section !== null) {
      current = { section, lines: [] }
      groups.push(current)
      continue
    }
    if (line.heading === null && FULL_CHANGELOG_LINE.test(line.text.trim())) {
      trailer.push(line.text)
      continue
    }
    current.lines.push(line.text)
  }
  groups.push({ section: null, lines: trailer })
  return groups
    .map((group) => ({ section: group.section, markdown: joinReshapedReleaseNotes(group.lines) }))
    .filter((group) => group.markdown.length > 0)
}

/** True when the notes carry at least one titled section, so the card draws
 *  section groups rather than one markdown column. */
export function hasReleaseNoteSections(groups: readonly ReleaseNoteGroup[]): boolean {
  return groups.some((group) => group.section !== null)
}
