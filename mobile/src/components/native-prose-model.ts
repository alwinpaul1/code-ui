import {
  ADDRESS_TOKEN_GROUP,
  BOLD_TOKEN_GROUP,
  codeSpanContent,
  createMarkdownInlineMatcher,
  markdownInlineTokenPattern
} from './markdown-inline-matcher'
import { afterRefusedUnderscoreOpener, autolinkParts, isIntrawordUnderscoreToken } from './markdown-inline-token-rules'
import { unescapeMarkdownText } from './markdown-inline-escapes'
import { detectFilePathSegments, isFilePathCodeSpan, normalizeFilePath } from './markdown-file-path-detection'
import { markdownInlinePlainText } from './markdown-plain-text'
import { listMarker } from './mobile-markdown-list-marker'
import type { ProseBlock } from './mobile-markdown-prose-runs'
import type { MarkdownTypography } from './mobile-markdown-prose-scale'

/**
 * A prose run of a reply as ONE text with paragraph and character styles,
 * which modules/orca-native-prose draws on Android as one selectable TextView
 * (NativeProseSpec.kt parses this shape field for field, and
 * NativeProseLayout.kt builds the text from it in this order).
 *
 * Why native: the user wants the transcript to read like the Claude Android
 * app (2026-10-09, reference screenshot): bullets set in from the margin, a
 * wrapped bullet line hanging under the bullet's words, a little air between
 * bullets. React Native's Text has no paragraph margin and no space after a
 * paragraph, and an item that is a Text of its own stops a selection at its
 * edge, because Android selection cannot cross TextViews. A Spannable carries
 * both (LeadingMarginSpan, a line-height span with space after) in one view.
 *
 * Everything here is in dp at no zoom; the native side scales by the reader's
 * pinch and turns dp and sp into pixels. Offsets are UTF-16 units, which is
 * what a Java String counts too.
 *
 * `text` is what a Copy puts on the clipboard: the words drawn, a bullet as
 * its glyph, no Markdown marks.
 */
export type NativeProseModel = {
  text: string
  paragraphs: NativeProseParagraph[]
  spans: NativeProseSpan[]
  links: NativeProseLink[]
}

export type NativeProseParagraphKind = 'body' | 'heading' | 'item' | 'gap' | 'rule'

export type NativeProseParagraph = {
  kind: NativeProseParagraphKind
  /** [start, end) in `text`, without the newline that ends it. */
  start: number
  end: number
  fontSize: number
  /** Every line of the paragraph is this tall. */
  lineHeight: number
  /** Added below the paragraph's last line. */
  spaceAfter: number
  /** The first line's left margin. */
  indent: number
  /** How many characters from `start` the later lines hang past: the
   *  marker and its space, measured natively in the paint they are drawn in,
   *  so a wrapped line starts under the item's words. */
  hang: number
  /** The rest of an item after a hard break: its lines take that item
   *  paragraph's hanging margin, first line included. */
  alignTo?: number
}

export type NativeProseStyle = 'bold' | 'italic' | 'strike' | 'code' | 'labelCode' | 'link' | 'marker' | 'rule'

export type NativeProseSpan = {
  start: number
  end: number
  style: NativeProseStyle
  /** Index into `links` for a `link` span. */
  link?: number
}

export type NativeProseLink = { kind: 'href'; href: string } | { kind: 'file'; path: string }

/** A bullet's first line sits this far in from the margin: the Claude app's
 *  bullet is about 9 dp in at the Small size (reference screenshot), and its
 *  glyph carries a dp of side bearing. */
export const NATIVE_PROSE_LIST_INDENT = 8
/** One more level of nesting. */
export const NATIVE_PROSE_LIST_DEPTH_INDENT = 16
/** Between two bullets: 4 px at the screenshot's 19 px line pitch, which is
 *  about 4.6 dp at the transcript's 22 (15/22); 4.5 was set when its line was
 *  21 and is within a dp of that. Between blocks it stays the typography's
 *  blockGap. */
export const NATIVE_PROSE_LIST_ITEM_GAP = 4.5
/** A `---`, as the Text path draws it (MobileMarkdown RULE_TEXT). */
export const NATIVE_PROSE_RULE_TEXT = '─'.repeat(24)
/** An item continued after a fence carries no marker; its words still start
 *  about where a bullet's would. */
const CONTINUATION_EXTRA_INDENT = 10

type Options = {
  typography: MarkdownTypography
  /** The surface opens files: paths in prose and in code are links. */
  opensFiles: boolean
}

class ModelBuilder {
  text = ''
  readonly paragraphs: NativeProseParagraph[] = []
  readonly spans: NativeProseSpan[] = []
  readonly links: NativeProseLink[] = []

  append(words: string): void {
    this.text += words
  }

  span(start: number, style: NativeProseStyle, link?: NativeProseLink): void {
    if (this.text.length <= start) {
      return
    }
    const span: NativeProseSpan = { start, end: this.text.length, style }
    if (link) {
      span.link = this.links.length
      this.links.push(link)
    }
    this.spans.push(span)
  }

  /** Starts a paragraph at the end of the text, a newline after the one before. */
  paragraph(fields: Omit<NativeProseParagraph, 'start' | 'end'>, write: () => void): NativeProseParagraph {
    if (this.paragraphs.length > 0) {
      this.text += '\n'
    }
    const start = this.text.length
    write()
    const paragraph: NativeProseParagraph = { ...fields, start, end: this.text.length }
    this.paragraphs.push(paragraph)
    return paragraph
  }
}

function plainRun(builder: ModelBuilder, words: string, opensFiles: boolean): void {
  if (!opensFiles) {
    builder.append(words)
    return
  }
  for (const segment of detectFilePathSegments(words)) {
    const start = builder.text.length
    builder.append(segment.value)
    if (segment.type === 'file') {
      builder.span(start, 'link', { kind: 'file', path: segment.path })
    }
  }
}

/** A link's words, as renderLinkLabel draws them: emphasis styled, code in
 *  the code face with no pill, and nothing in it a link of its own. */
function linkLabel(builder: ModelBuilder, label: string): void {
  const pattern = createMarkdownInlineMatcher(label, markdownInlineTokenPattern(), true, true)
  let pendingStart = 0
  let match
  while ((match = pattern.exec())) {
    const token = match[0]
    if (token.startsWith('_') && isIntrawordUnderscoreToken(label, match.index, token)) {
      pattern.lastIndex = afterRefusedUnderscoreOpener(label, match.index)
      continue
    }
    if (match.index > pendingStart) {
      builder.append(unescapeMarkdownText(label.slice(pendingStart, match.index)))
    }
    pendingStart = pattern.lastIndex
    const start = builder.text.length
    if (match.link?.image) {
      builder.append(markdownInlinePlainText(match.link.label) || 'image')
    } else if (match.link || match.group === ADDRESS_TOKEN_GROUP) {
      builder.append(token)
    } else if (token.startsWith('`')) {
      builder.append(codeSpanContent(token))
      builder.span(start, 'labelCode')
    } else {
      const wide = token.startsWith('~~') || match.group === BOLD_TOKEN_GROUP
      linkLabel(builder, wide ? token.slice(2, -2) : token.slice(1, -1))
      builder.span(start, token.startsWith('~~') ? 'strike' : match.group === BOLD_TOKEN_GROUP ? 'bold' : 'italic')
    }
  }
  if (pendingStart < label.length) {
    builder.append(unescapeMarkdownText(label.slice(pendingStart)))
  }
}

/** One paragraph's inline Markdown, as MobileMarkdown's renderInline draws it. */
function inline(builder: ModelBuilder, text: string, opensFiles: boolean): void {
  const pattern = createMarkdownInlineMatcher(text, markdownInlineTokenPattern(), true, true)
  let pendingStart = 0
  let match
  while ((match = pattern.exec())) {
    const token = match[0]
    if (token.startsWith('_') && isIntrawordUnderscoreToken(text, match.index, token)) {
      pattern.lastIndex = afterRefusedUnderscoreOpener(text, match.index)
      continue
    }
    if (match.index > pendingStart) {
      plainRun(builder, unescapeMarkdownText(text.slice(pendingStart, match.index)), opensFiles)
    }
    pendingStart = pattern.lastIndex
    const start = builder.text.length
    const link = match.link
    if (link) {
      if (link.image) {
        builder.append(markdownInlinePlainText(link.label) || 'image')
      } else {
        linkLabel(builder, link.label)
      }
      builder.span(start, 'link', { kind: 'href', href: link.href })
    } else if (match.group === ADDRESS_TOKEN_GROUP) {
      const { url, words, trailing } = autolinkParts(token)
      builder.append(words)
      builder.span(start, 'link', { kind: 'href', href: url })
      builder.append(trailing)
    } else if (token.startsWith('`')) {
      const code = codeSpanContent(token)
      builder.append(code)
      builder.span(start, 'code')
      if (opensFiles && isFilePathCodeSpan(code)) {
        builder.span(start, 'link', { kind: 'file', path: normalizeFilePath(code.trim()) })
      }
    } else {
      const wide = token.startsWith('~~') || match.group === BOLD_TOKEN_GROUP
      inline(builder, wide ? token.slice(2, -2) : token.slice(1, -1), opensFiles)
      builder.span(start, token.startsWith('~~') ? 'strike' : match.group === BOLD_TOKEN_GROUP ? 'bold' : 'italic')
    }
  }
  if (pendingStart < text.length) {
    plainRun(builder, unescapeMarkdownText(text.slice(pendingStart)), opensFiles)
  }
}

/**
 * One member's inline Markdown, drawn in ONE inline pass over the whole of it,
 * as the Text path draws it: a pass per line left `**bold` on one line and
 * `text**` on the next as literal stars (MobileMarkdown.tsx, from the
 * device). The words drawn are then cut into one paragraph per line, since a
 * newline ends an Android paragraph either way: the space after lands below
 * the LAST line, and an item's later lines hang where its first line's words
 * start (alignTo). A bold run or a code span may cross that cut.
 */
function brokenLines(
  builder: ModelBuilder,
  text: string,
  fields: Omit<NativeProseParagraph, 'start' | 'end'>,
  opensFiles: boolean,
  before?: () => void
): void {
  if (builder.paragraphs.length > 0) {
    builder.append('\n')
  }
  const start = builder.text.length
  before?.()
  inline(builder, text, opensFiles)
  const lines = builder.text.slice(start).split('\n')
  const first = builder.paragraphs.length
  let at = start
  lines.forEach((line, lineIndex) => {
    const last = lineIndex === lines.length - 1
    builder.paragraphs.push({
      ...fields,
      start: at,
      end: at + line.length,
      spaceAfter: last ? fields.spaceAfter : 0,
      ...(lineIndex > 0 ? { hang: 0, ...(fields.kind === 'item' ? { alignTo: first } : {}) } : {})
    })
    at += line.length + 1
  })
}

/**
 * The model of one prose run, or null when the run holds something only the
 * Text path can draw (an image), or nothing at all.
 */
export function buildNativeProseModel(members: readonly ProseBlock[], options: Options): NativeProseModel | null {
  if (members.length === 0 || members.some((member) => member.type === 'image')) {
    return null
  }
  const { typography, opensFiles } = options
  const { prose } = typography
  const builder = new ModelBuilder()
  const body = { fontSize: prose.fontSize, lineHeight: prose.lineHeight, spaceAfter: 0, indent: 0, hang: 0 }
  members.forEach((member, memberIndex) => {
    if (memberIndex > 0) {
      // The blank line between blocks: a newline a selection crosses and a
      // copy keeps, as tall as the surface's block gap.
      builder.paragraph({ ...body, kind: 'gap', lineHeight: typography.blockGap ?? prose.lineHeight }, () => {})
    }
    switch (member.type) {
      case 'heading': {
        const level =
          member.level <= 1
            ? typography.headingLevel1
            : member.level === 2
              ? typography.headingLevel2
              : member.level === 3
                ? typography.headingLevel3
                : typography.heading
        const start = builder.text.length + (builder.paragraphs.length > 0 ? 1 : 0)
        brokenLines(
          builder,
          member.text,
          { ...body, kind: 'heading', fontSize: level.fontSize, lineHeight: level.lineHeight },
          opensFiles
        )
        builder.span(start, 'bold')
        break
      }
      case 'rule':
        builder.paragraph({ ...body, kind: 'rule' }, () => {
          const start = builder.text.length
          builder.append(NATIVE_PROSE_RULE_TEXT)
          builder.span(start, 'rule')
        })
        break
      case 'list': {
        const lastItem = member.items.length - 1
        member.items.forEach((item, itemIndex) => {
          const marker = listMarker(item)
          const prefix = marker ? `${marker} ` : ''
          const indent =
            NATIVE_PROSE_LIST_INDENT +
            item.depth * NATIVE_PROSE_LIST_DEPTH_INDENT +
            (marker ? 0 : CONTINUATION_EXTRA_INDENT)
          brokenLines(
            builder,
            item.text,
            {
              ...body,
              kind: 'item',
              indent,
              hang: prefix.length,
              spaceAfter: itemIndex < lastItem ? NATIVE_PROSE_LIST_ITEM_GAP : 0
            },
            opensFiles,
            () => {
              if (!marker) {
                return
              }
              const start = builder.text.length
              builder.append(marker)
              builder.span(start, 'marker')
              builder.append(' ')
            }
          )
        })
        break
      }
      case 'paragraph':
        brokenLines(builder, member.text, { ...body, kind: 'body' }, opensFiles)
        break
      case 'image':
        // Refused above.
        break
      default: {
        const unhandled: never = member
        throw new Error(`Unhandled prose block ${String(unhandled)}`)
      }
    }
  })
  // Code last: Android applies a text's metric spans in the order they were
  // set, and a bold or heading face set after a code span would draw the code
  // in the bold sans instead of the code face (NativeProseLayout.kt sets them
  // in this order).
  const isCode = (span: NativeProseSpan) => span.style === 'code' || span.style === 'labelCode'
  const spans = [...builder.spans.filter((span) => !isCode(span)), ...builder.spans.filter(isCode)]
  return { text: builder.text, paragraphs: builder.paragraphs, spans, links: builder.links }
}
