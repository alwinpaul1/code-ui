/**
 * Claude Code 2.1.281 records a file dropped or dragged into its own prompt as
 * `@"<absolute path>"`, inline in the user turn's text — verified against
 * session 967668df-a7d9-40e7-964b-7812815c010d, the "76514539-Screen_..." row
 * (docs/claude-app-parity.md item 9). The Claude app never shows that marker:
 * it draws the file as a card (an upper-case extension badge, the original
 * name) and leaves the rest of the prompt as the caption. Code UI showed the
 * raw marker text instead — this pulls it back out so the render layer can
 * draw the card and pass the caption on unchanged.
 *
 * Only the quoted form is matched. No unquoted `@/path` mention has turned up
 * in any recorded session (grepped across every project's transcripts), so
 * there is no observed shape for it to match — inventing one would be a
 * guess, not a port, and CLAUDE.md's own rule for this codebase is to refuse
 * rather than guess at an unverified screen shape.
 */

/** Leading horizontal whitespace (not a newline) goes with the marker, the
 *  same way an `[Image #N]` marker takes its leading space with it — otherwise
 *  the caption keeps a stray double space where the mention sat. */
const FILE_MENTION_PATTERN = /[^\S\r\n]*@"(\/[^"\n]+)"/g

/** Claude Code's own upload id: eight lowercase hex characters and a dash,
 *  stamped in front of the original name when it copies a dropped file into
 *  `~/.claude-work/uploads/<session>/`. The Claude app's card names the file
 *  without it. */
const UPLOAD_ID_PREFIX = /^[0-9a-f]{8}-/

export type FileMentionCard = {
  /** The absolute path exactly as Claude Code recorded it. */
  path: string
  /** The upload id and every directory gone: what the card names the file. */
  name: string
  /** Upper-case, for the card's badge ("MP4", "PDF"); empty when the file
   *  carries no extension. */
  ext: string
}

function baseName(path: string): string {
  const segments = path.split(/[\\/]/)
  return segments[segments.length - 1] || path
}

function splitExtension(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.')
  // A leading dot (dotfile) or no dot at all: no extension to badge.
  if (dot <= 0) {
    return { stem: name, ext: '' }
  }
  return { stem: name.slice(0, dot), ext: name.slice(dot + 1).toUpperCase() }
}

function fileMentionCard(path: string): FileMentionCard {
  const named = baseName(path).replace(UPLOAD_ID_PREFIX, '')
  const { stem, ext } = splitExtension(named)
  return { path, name: stem, ext }
}

/** Pull every `@"<path>"` file mention out of a user message's text, in
 *  reading order, alongside the caption with the markers (and the space each
 *  one sat in) gone. `cards` is empty and `caption` is `text` unchanged when
 *  there is no mention to find. */
export function parseFileMentionText(text: string): {
  cards: FileMentionCard[]
  caption: string
} {
  const cards: FileMentionCard[] = []
  for (const match of text.matchAll(FILE_MENTION_PATTERN)) {
    const path = match[1]
    if (path) {
      cards.push(fileMentionCard(path))
    }
  }
  if (cards.length === 0) {
    return { cards, caption: text }
  }
  return { cards, caption: text.replace(FILE_MENTION_PATTERN, '').trim() }
}
