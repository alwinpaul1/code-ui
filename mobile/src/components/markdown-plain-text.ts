import {
  ADDRESS_TOKEN_GROUP,
  BOLD_TOKEN_GROUP,
  codeSpanContent,
  createMarkdownInlineMatcher,
  markdownInlineTokenPattern
} from './markdown-inline-matcher'
import { afterRefusedUnderscoreOpener, autolinkParts, isIntrawordUnderscoreToken } from './markdown-inline-token-rules'
import { unescapeMarkdownText } from './markdown-inline-escapes'
import { isRemoteImageUrl } from './markdown-image-source'
import { markdownLinkDestination } from './markdown-link-destination'
import { listMarker } from './mobile-markdown-list-marker'
import { parseMobileMarkdown, type MobileMarkdownBlock } from './mobile-markdown-parser'
import { markdownDocumentSource, normalizeMobileMarkdownPreviewHtml } from './mobile-markdown-preview-html'

// A reply's Copy put its Markdown SOURCE on the clipboard, so a pasted reply
// carried every `**`, backtick and fence the screen had drawn as bold, pills
// and a code block (2026-09-28, the user: "Why i copy text markdown things
// come ** ** ''' fix it"). This is the text MobileMarkdown draws, read off the
// same parse and the same inline tokens, so what lands on the clipboard is
// what the reader saw.
//
// Two places it says more than the screen, on purpose: a web link keeps its
// address after its words, and a table's cells are split by tabs. The source
// the Copy used to hand over had both, and a paste should not lose where a
// link went.

const WEB_HREF = /^(https?:|mailto:)/i
const DATA_URL = /^data:/i

/** A link's words, with the address after them when it is a web one the
 *  words do not already spell. A file link's path is the app's to open, not
 *  the reader's to paste. */
function linkText(label: string, href: string): string {
  const address = markdownLinkDestination(href)
  if (!WEB_HREF.test(address) || label === address) {
    return label || address
  }
  return label ? `${label} (${address})` : address
}

/** An image block as MobileMarkdownImage draws it in a chat, which has no way
 *  to load a file beside the reply: a web image as its words and address, a
 *  `data:` one as its words alone (its address is the picture itself), and a
 *  file one as its words with the path under them, the fallback it draws. */
function imagePlainText(markedAlt: string, url: string): string {
  const alt = markdownInlinePlainText(markedAlt)
  const address = markdownLinkDestination(url)
  if (DATA_URL.test(address)) {
    return alt
  }
  if (isRemoteImageUrl(address)) {
    // `//x.dev/a.png` is a web image too, though it names no scheme.
    return alt && alt !== address ? `${alt} (${address})` : address
  }
  return alt ? `${alt}\n${address}` : address
}

/** One run of inline Markdown as the words it draws: the marks around bold,
 *  italic, strike and code dropped, links read as `linkText`, an image as its
 *  alt text. Finds the same tokens as MobileMarkdown's `renderInline`, and a
 *  link's label and an image's alt are read the same way the screen reads them
 *  (mobile-markdown-link-label.tsx): in a `label`, an image is its words
 *  alone (a badge's picture is not drawn, so its address is not copied), and
 *  a link or an address is drawn as written. */
export function markdownInlinePlainText(text: string, label = false): string {
  const pattern = createMarkdownInlineMatcher(text, markdownInlineTokenPattern(), true, true)
  let out = ''
  let pendingStart = 0
  let match
  while ((match = pattern.exec())) {
    const token = match[0]
    if (token.startsWith('_') && isIntrawordUnderscoreToken(text, match.index, token)) {
      pattern.lastIndex = afterRefusedUnderscoreOpener(text, match.index)
      continue
    }
    out += unescapeMarkdownText(text.slice(pendingStart, match.index))
    pendingStart = pattern.lastIndex
    const link = match.link
    const address = match.group === ADDRESS_TOKEN_GROUP
    if (link?.image) {
      const words = markdownInlinePlainText(link.label) || 'image'
      out += label || DATA_URL.test(markdownLinkDestination(link.href)) ? words : linkText(words, link.href)
    } else if (label && (link || address)) {
      out += token
    } else if (link) {
      out += linkText(markdownInlinePlainText(link.label, true), link.href)
    } else if (address) {
      const { words, trailing } = autolinkParts(token)
      out += words + trailing
    } else if (token.startsWith('`')) {
      out += codeSpanContent(token)
    } else if (token.startsWith('~~') || match.group === BOLD_TOKEN_GROUP) {
      out += markdownInlinePlainText(token.slice(2, -2), label)
    } else {
      out += markdownInlinePlainText(token.slice(1, -1), label)
    }
  }
  return out + unescapeMarkdownText(text.slice(pendingStart))
}

/** A table cell as a Copy pastes it: a `<br>` in it, drawn as a line break
 *  inside the cell, is a space, so the row stays one line of tab-separated
 *  cells (markdown-inline-breaks.ts). */
function cellPlainText(cell: string): string {
  const plain = markdownInlinePlainText(cell)
  if (!plain.includes('\n')) {
    return plain
  }
  return plain
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ')
}

/** Two spaces a level, the way the screen steps a nested item in. */
const LIST_INDENT = '  '

function blockPlainText(block: MobileMarkdownBlock): string {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
    case 'quote':
      return markdownInlinePlainText(block.text)
    case 'code':
      return block.text
    case 'list':
      return block.items
        .map((item) => {
          const marker = listMarker(item)
          const indent = LIST_INDENT.repeat(item.depth)
          // The rest of an item a fence cut in two sits under its words.
          return `${indent}${marker ? `${marker} ` : LIST_INDENT}${markdownInlinePlainText(item.text)}`
        })
        .join('\n')
    case 'image':
      return block.url ? imagePlainText(block.alt, block.url) : block.alt
    case 'table':
      return [block.headers, ...block.rows].map((row) => row.map(cellPlainText).join('\t')).join('\n')
    case 'rule':
      return ''
    default: {
      const unhandled: never = block
      return unhandled
    }
  }
}

/** A Markdown document as the plain text MobileMarkdown draws for it, blocks
 *  a blank line apart. Empty for a document that draws nothing. */
export function markdownPlainText(content: string): string {
  // The same document MobileMarkdown draws, first line's indent and all.
  const text = markdownDocumentSource(content)
  if (!text) {
    return ''
  }
  return parseMobileMarkdown(normalizeMobileMarkdownPreviewHtml(text))
    .map(blockPlainText)
    .filter((block) => block.trim() !== '')
    .join('\n\n')
}
