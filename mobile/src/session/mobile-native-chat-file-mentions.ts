import { isTextBlock, type NativeChatBlock } from '../../../src/shared/native-chat-types'
import { classifyMobileArtifact } from './mobile-artifact-kind'

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
 *  the caption keeps a stray double space where the mention sat. The closing
 *  quote must end the mention (space, line end or punctuation after it): a
 *  path with a quote inside, `@"/a"b.pdf"`, has no recorded shape, so it
 *  stays the text it is instead of becoming a card named after half of it. */
const FILE_MENTION_PATTERN = /[^\S\r\n]*@"(\/[^"\n]+)"(?=\s|$|[,.;:!?)])/g

/** Orca's own note for a file the phone attached (buildMobileNativeChatFileNotes
 *  in mobile-native-chat-file-attachment.ts), one whole line: the file's real
 *  name, then the `.png` upload container it travelled in. A line cut short
 *  or reworded is not this note and stays text. */
const ATTACHED_FILE_NOTE =
  /^Attached file "(.+)" is on this machine at (\S.*?)\. The \.png extension is only the upload container; (?:move it to a path ending in "[^"\n]*"|rename it) before reading it\.$/

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
  /** `path` is Orca's `.png` upload container, not the file under its own
   *  name: reading it as what its name says would read the wrong type. */
  container?: true
  /** A file the prompt carried as `file_attachments` in Anthropic's copy of the
   *  session: it lives on Anthropic's servers, `path` is only a stable key. */
  attachment?: CcrAttachmentRef
}

/** One entry of an Anthropic user event's `file_attachments`
 *  (`{file_uuid, file_name, is_image}`, recorded 2026-10-15). */
export type CcrAttachmentRef = { fileUuid: string; fileName: string; isImage: boolean }

/** The `presentation` the carrier block of an attachment has: the kind, then the file's uuid. The
 *  block's text is the file name, so a row drawn by anything that does not know the carrier still
 *  names the file. */
const ATTACHMENT_PRESENTATION = /^ccr-attachment:(image|file):(.+)$/

/** The block that carries one attachment from the Anthropic decoder to the prompt's card row. */
export function ccrAttachmentBlock(ref: CcrAttachmentRef): NativeChatBlock {
  return { type: 'text', text: ref.fileName, presentation: `ccr-attachment:${ref.isImage ? 'image' : 'file'}:${ref.fileUuid}` }
}

function attachmentOfBlock(block: NativeChatBlock): CcrAttachmentRef | null {
  if (!isTextBlock(block) || !block.presentation) {
    return null
  }
  const match = ATTACHMENT_PRESENTATION.exec(block.presentation)
  return match && block.text ? { fileUuid: match[2]!, fileName: block.text, isImage: match[1] === 'image' } : null
}

/** The extension the Claude app badges (p530.java:104-126): what follows the last dot, unless it is
 *  empty, holds a space or a bidi control, or is only digits ("version 2.5" has none). */
export function splitAttachmentName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.')
  const ext = dot === -1 ? '' : name.slice(dot + 1)
  if (ext === '' || /[\s\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(ext) || /^\d+$/.test(ext)) {
    return { stem: name, ext: '' }
  }
  return { stem: name.slice(0, dot), ext: ext.toUpperCase() }
}

function attachmentCard(ref: CcrAttachmentRef): FileMentionCard {
  const { stem, ext } = splitAttachmentName(baseName(ref.fileName))
  return { path: `anthropic-file:${ref.fileUuid}`, name: stem, ext, attachment: ref }
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

/** A card for a file the agent sent (SendUserFile): its own name, kept
 *  whole. The upload-id rule above is for Claude Code's copies of a dropped
 *  file, and a sent file is the agent's own. */
export function sentFileCard(path: string): FileMentionCard {
  const { stem, ext } = splitExtension(baseName(path))
  return { path, name: stem, ext }
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

/** One line of Orca's attachment note as a card, or null when the line is
 *  not that note, whole. */
function attachedFileNoteCard(line: string): FileMentionCard | null {
  const match = ATTACHED_FILE_NOTE.exec(line)
  if (!match) {
    return null
  }
  const { stem, ext } = splitExtension(match[1]!)
  return { path: match[2]!, name: stem, ext, container: true }
}

/** A text's uploads in reading order (Orca puts its notes first) and the
 *  words left once they are gone. */
function uploadsInText(text: string): { cards: FileMentionCard[]; caption: string } {
  const lines = text.split('\n')
  const noted = lines.map(attachedFileNoteCard)
  const notes = noted.filter((card): card is FileMentionCard => card !== null)
  const rest = notes.length > 0 ? lines.filter((_, index) => noted[index] === null).join('\n').trim() : text
  const mentions = parseFileMentionText(rest)
  return { cards: [...notes, ...mentions.cards], caption: mentions.caption }
}

/**
 * A sent prompt's uploads, taken out of its text so they can be drawn as the
 * Claude app draws them: a row of cards above the bubble, with only the words
 * inside it (m330.java:7339, com.anthropic.claude 1.261009.20). Both forms
 * reach the transcript: Claude Code's `@"<path>"` mention for a file dropped
 * into its prompt, and Orca's "Attached file …" note for one the phone sent.
 * A text block left with no words is dropped; every other block stays where
 * it was. With no upload the blocks come back as given.
 */
export function takeUserUploads(blocks: readonly NativeChatBlock[]): {
  cards: FileMentionCard[]
  blocks: readonly NativeChatBlock[]
} {
  const cards: FileMentionCard[] = []
  const kept: NativeChatBlock[] = []
  for (const block of blocks) {
    if (!isTextBlock(block)) {
      kept.push(block)
      continue
    }
    const attachment = attachmentOfBlock(block)
    if (attachment) {
      cards.push(attachmentCard(attachment))
      continue
    }
    const found = uploadsInText(block.text)
    if (found.cards.length === 0) {
      kept.push(block)
      continue
    }
    cards.push(...found.cards)
    if (found.caption) {
      kept.push({ ...block, text: found.caption })
    }
  }
  return { cards, blocks: cards.length > 0 ? kept : blocks }
}

/** Plain-text files the reader shows as text when read by host path. The
 *  other readable kinds come from classifyMobileArtifact. */
const TEXT_EXTENSIONS = new Set(['txt', 'log', 'json', 'csv', 'tsv', 'yaml', 'yml', 'xml', 'ts', 'tsx', 'js', 'jsx', 'py', 'sh'])

/**
 * Whether a tap on the card can open the file on the phone: the chat's file
 * opener resolves an absolute host path to a read grant, and the reader
 * shows an image, a PDF, Markdown, HTML or text from one. A grant is never
 * streamed as media (mobile-file-media.ts), so a recording has no way to
 * play, and an unknown type would land on "binary file": neither gets a tap.
 * Orca's note names a `.png` container, never the file itself.
 */
export function uploadOpensOnPhone(card: FileMentionCard): boolean {
  // An attachment is fetched from Anthropic by its uuid, whatever it is (ccr-attachment-open.ts).
  if (card.attachment) {
    return true
  }
  if (card.container || !card.ext) {
    return false
  }
  return classifyMobileArtifact(card.path) !== 'other' || TEXT_EXTENSIONS.has(card.ext.toLowerCase())
}
