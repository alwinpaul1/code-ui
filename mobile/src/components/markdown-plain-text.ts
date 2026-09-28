import {
  codeSpanContent,
  createMarkdownInlineMatcher,
  markdownInlineTokenPattern
} from './markdown-inline-matcher'
import { isIntrawordUnderscoreToken, trimAutolinkTrailingPunctuation } from './markdown-inline-token-rules'
import { isRemoteImageUrl } from './markdown-image-source'
import { listMarker } from './mobile-markdown-list-marker'
import { parseMobileMarkdown, type MobileMarkdownBlock } from './mobile-markdown-parser'
import { normalizeMobileMarkdownPreviewHtml } from './mobile-markdown-preview-html'

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

/** A link's destination without its title: `https://x.dev "The docs"` is
 *  `https://x.dev`. Only a quoted title comes off; the link on screen opens
 *  an address with a space in it whole, so the copy keeps it whole too. (An
 *  `<…>` destination never gets here: the preview's HTML cleanup takes it for
 *  a tag first, on screen too.) */
function destination(href: string): string {
  return href.trim().replace(/\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/, '')
}

/** A link's words, with the address after them when it is a web one the
 *  words do not already spell. A file link's path is the app's to open, not
 *  the reader's to paste. */
function linkText(label: string, href: string): string {
  const address = destination(href)
  if (!WEB_HREF.test(address) || label === address) {
    return label || address
  }
  return label ? `${label} (${address})` : address
}

/** An image block as MobileMarkdownImage draws it in a chat, which has no way
 *  to load a file beside the reply: a web image as its words and address, a
 *  `data:` one as its words alone (its address is the picture itself), and a
 *  file one as its words with the path under them, the fallback it draws. */
function imagePlainText(alt: string, url: string): string {
  const address = destination(url)
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
 *  italic, strike and code dropped, links read as `linkText`. Finds the same
 *  tokens as MobileMarkdown's `renderInline`, with one difference: the
 *  renderer draws a link's label as written, so "[`app.ts`](…)" shows its
 *  backticks, and the copy takes them off too. */
function inlinePlainText(text: string): string {
  const pattern = createMarkdownInlineMatcher(text, markdownInlineTokenPattern(), true, true)
  let out = ''
  let pendingStart = 0
  let match
  while ((match = pattern.exec())) {
    const token = match[0]
    if (token.startsWith('_') && isIntrawordUnderscoreToken(text, match.index, token)) {
      pattern.lastIndex = match.index + 1
      continue
    }
    out += text.slice(pendingStart, match.index)
    pendingStart = pattern.lastIndex
    const image = token.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (image) {
      out += DATA_URL.test(destination(image[2]!)) ? image[1] || 'image' : linkText(image[1] || 'image', image[2]!)
    } else if (link) {
      out += linkText(inlinePlainText(link[1]!), link[2]!)
    } else if (/^https?:\/\//i.test(token)) {
      const { url, trailing } = trimAutolinkTrailingPunctuation(token)
      out += url + trailing
    } else if (token.startsWith('`')) {
      out += codeSpanContent(token)
    } else if (token.startsWith('~~') || token.startsWith('**') || token.startsWith('__')) {
      out += inlinePlainText(token.slice(2, -2))
    } else {
      out += inlinePlainText(token.slice(1, -1))
    }
  }
  return out + text.slice(pendingStart)
}

/** Two spaces a level, the way the screen steps a nested item in. */
const LIST_INDENT = '  '

function blockPlainText(block: MobileMarkdownBlock): string {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
    case 'quote':
      return inlinePlainText(block.text)
    case 'code':
      return block.text
    case 'list':
      return block.items
        .map((item) => {
          const marker = listMarker(item)
          const indent = LIST_INDENT.repeat(item.depth)
          // The rest of an item a fence cut in two sits under its words.
          return `${indent}${marker ? `${marker} ` : LIST_INDENT}${inlinePlainText(item.text)}`
        })
        .join('\n')
    case 'image':
      return block.url ? imagePlainText(block.alt, block.url) : block.alt
    case 'table':
      return [block.headers, ...block.rows].map((row) => row.map(inlinePlainText).join('\t')).join('\n')
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
  const text = content.trim()
  if (!text) {
    return ''
  }
  return parseMobileMarkdown(normalizeMobileMarkdownPreviewHtml(text))
    .map(blockPlainText)
    .filter((block) => block.trim() !== '')
    .join('\n\n')
}
