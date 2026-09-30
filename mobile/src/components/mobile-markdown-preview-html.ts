import {
  findMobileMarkdownMarkupTagEnd,
  findNextPairedMarkupOpener,
  isPairedMarkupOpener,
  replaceMobileMarkdownPairedMarkupTags,
  stripMobileMarkdownMarkupTags
} from './mobile-markdown-preview-tag-stripper'
import { markdownCodeRanges } from './markdown-code-ranges'

// Why: README HTML snippets can document escaped entities; repeated cleanup
// passes must not turn `&amp;lt;` into a real tag and strip it.
const escapedHtmlEntityTokens = [
  { pattern: /&amp;nbsp;/gi, token: '\uE000ORCA_MD_ENTITY_NBSP\uE000', value: '&nbsp;' },
  { pattern: /&amp;lt;/gi, token: '\uE000ORCA_MD_ENTITY_LT\uE000', value: '&lt;' },
  { pattern: /&amp;gt;/gi, token: '\uE000ORCA_MD_ENTITY_GT\uE000', value: '&gt;' },
  { pattern: /&amp;quot;/gi, token: '\uE000ORCA_MD_ENTITY_QUOT\uE000', value: '&quot;' },
  { pattern: /&amp;#39;/gi, token: '\uE000ORCA_MD_ENTITY_APOS\uE000', value: '&#39;' },
  { pattern: /&lt;/gi, token: '\uE000ORCA_MD_ENTITY_RAW_LT\uE000', value: '<' },
  { pattern: /&gt;/gi, token: '\uE000ORCA_MD_ENTITY_RAW_GT\uE000', value: '>' }
] as const

function protectEscapedHtmlEntities(value: string): string {
  return escapedHtmlEntityTokens.reduce(
    (next, entity) => next.replace(entity.pattern, entity.token),
    value
  )
}

function restoreEscapedHtmlEntities(value: string): string {
  return escapedHtmlEntityTokens.reduce(
    (next, entity) => next.replaceAll(entity.token, entity.value),
    value
  )
}

// Why: a backslash before `<` or `&` makes it text (CommonMark), so `\<b>`
// is no tag and `\&amp;` no entity. This pass took `\<b>x\</b>` for a bold
// tag pair, and the phone drew "\", bold x, "\" (review, 2026-09-30). The
// escaped character stands aside through the pass and keeps its backslash,
// which the inline pass drops (markdown-inline-escapes.ts). Only an odd run of
// backslashes escapes: `\\<b>` is a backslash and a tag.
const BACKSLASH_RUN = /\\+([<&]?)/g
const ESCAPED_LT_TOKEN = '\uE000ORCA_MD_ESCAPED_LT\uE000'
const ESCAPED_AMP_TOKEN = '\uE000ORCA_MD_ESCAPED_AMP\uE000'

function protectEscapedMarkup(value: string): string {
  if (!value.includes('\\')) {
    return value
  }
  return value.replace(BACKSLASH_RUN, (run: string, after: string) =>
    after && (run.length - 1) % 2 === 1
      ? `${run.slice(0, -1)}${after === '<' ? ESCAPED_LT_TOKEN : ESCAPED_AMP_TOKEN}`
      : run
  )
}

function restoreEscapedMarkup(value: string): string {
  return value.replaceAll(ESCAPED_LT_TOKEN, '<').replaceAll(ESCAPED_AMP_TOKEN, '&')
}

function decodeHtmlEntities(value: string, preserveEscapedEntities = false): string {
  const next = preserveEscapedEntities ? protectEscapedHtmlEntities(value) : value

  return next
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
}

function stripTags(value: string): string {
  const { protectedText, codeSpans, placeholderPrefix } = protectMarkdownCode(value)
  const stripped = decodeHtmlEntities(
    stripMobileMarkdownMarkupTags(protectedText.replace(/<!--[\s\S]*?-->/g, '')),
    true
  )
    // Trailing whitespace goes, EXCEPT the two spaces that are Markdown's hard
    // break. Stripping them was harmless while every newline rendered as a
    // break; now that prose reflows they are the only way a writer can ask for
    // a line to end, and deleting them here meant the parser never saw one.
    .replace(/[ \t]+\n/g, (run) => (/ {2}\n$/.test(run) ? '  \n' : '\n'))
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return restoreMarkdownCode(stripped, codeSpans, placeholderPrefix)
}

function attrValue(tag: string, name: string): string {
  let cursor = 1
  while (cursor < tag.length && !/[\s/>]/.test(tag[cursor] ?? '')) {
    cursor += 1
  }
  while (cursor < tag.length) {
    while (/\s/.test(tag[cursor] ?? '')) {
      cursor += 1
    }
    if (tag[cursor] === '>' || (tag[cursor] === '/' && tag[cursor + 1] === '>')) {
      return ''
    }

    const attributeStart = cursor
    while (!/[\s=/>]/.test(tag[cursor] ?? '>')) {
      cursor += 1
    }
    if (attributeStart === cursor) {
      cursor += 1
      continue
    }
    const attributeName = tag.slice(attributeStart, cursor)
    while (/\s/.test(tag[cursor] ?? '')) {
      cursor += 1
    }
    if (tag[cursor] !== '=') {
      continue
    }

    cursor += 1
    while (/\s/.test(tag[cursor] ?? '')) {
      cursor += 1
    }
    const quote = tag[cursor] === '"' || tag[cursor] === "'" ? tag[cursor] : ''
    if (quote) {
      cursor += 1
    }
    const valueStart = cursor
    if (quote) {
      const valueEnd = tag.indexOf(quote, cursor)
      if (valueEnd === -1) {
        return ''
      }
      cursor = valueEnd + 1
      if (attributeName.toLowerCase() === name) {
        return decodeHtmlEntities(tag.slice(valueStart, valueEnd))
      }
      continue
    }

    while (!/[\s>]/.test(tag[cursor] ?? '>')) {
      cursor += 1
    }
    if (attributeName.toLowerCase() === name) {
      return decodeHtmlEntities(tag.slice(valueStart, cursor))
    }
  }
  return ''
}

const tagAttributesSource = `(?:[^<>"']|"[^"]*"|'[^']*')*`
const imageTagPattern = new RegExp(`<img\\b${tagAttributesSource}>`, 'gi')

function normalizeAnchorTags(value: string): string {
  const lowerValue = value.toLowerCase()
  let output = ''
  let copyCursor = 0
  let searchCursor = 0
  let closingStart = -1

  while (searchCursor < value.length) {
    const start = findNextPairedMarkupOpener(value, lowerValue, 'a', searchCursor)
    if (start < 0) {
      break
    }
    const end = findMobileMarkdownMarkupTagEnd(value, start + 2)
    if (end < 0) {
      if (end === -2) {
        break
      }
      searchCursor = start + 2
      continue
    }
    if (!isPairedMarkupOpener(value, start + 2, end)) {
      searchCursor = end + 1
      continue
    }

    const tag = value.slice(start, end + 1)
    const href = attrValue(tag, 'href')
    if (!href) {
      searchCursor = end + 1
      continue
    }

    if (closingStart < end + 1) {
      closingStart = lowerValue.indexOf('</a>', end + 1)
    }
    if (closingStart < 0) {
      break
    }
    const nestedStart = findNextPairedMarkupOpener(value, lowerValue, 'a', end + 1)
    if (nestedStart >= 0 && nestedStart < closingStart) {
      searchCursor = nestedStart
      continue
    }

    const text = stripTags(value.slice(end + 1, closingStart))
    output += value.slice(copyCursor, start)
    output += href && text ? `[${text}](${href})` : text
    copyCursor = closingStart + 4
    searchCursor = copyCursor
  }

  return output + value.slice(copyCursor)
}

function normalizeInlineHtml(value: string): string {
  const imagesNormalized = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(imageTagPattern, (tag) => attrValue(tag, 'alt') || 'image')

  let next = normalizeAnchorTags(imagesNormalized)
  next = replaceMobileMarkdownPairedMarkupTags(next, ['strong', 'b'], (_name, inner) => {
    const text = stripTags(inner)
    return text ? `**${text}**` : ''
  })
  next = replaceMobileMarkdownPairedMarkupTags(next, ['em', 'i'], (_name, inner) => {
    const text = stripTags(inner)
    return text ? `*${text}*` : ''
  })
  next = replaceMobileMarkdownPairedMarkupTags(next, ['code', 'kbd'], (_name, inner) => {
    const text = stripTags(inner)
    return text ? `\`${text}\`` : ''
  })
  return next
}

// Why: Markdown code is literal source, so it must bypass the HTML strip pass.
const CODE_PLACEHOLDER_PREFIX_BASE = '\uE000ORCA_MD_CODE_'
const CODE_PLACEHOLDER_SUFFIX = '\uE000'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function codePlaceholderPrefix(content: string): string {
  let suffixLength = 0
  let cursor = 0
  while ((cursor = content.indexOf(CODE_PLACEHOLDER_PREFIX_BASE, cursor)) !== -1) {
    cursor += CODE_PLACEHOLDER_PREFIX_BASE.length
    const suffixStart = cursor
    while (content[cursor] === '_') {
      cursor += 1
    }
    // One extra underscore keeps the prefix longer than every authored run.
    suffixLength = Math.max(suffixLength, cursor - suffixStart + 1)
  }
  return CODE_PLACEHOLDER_PREFIX_BASE + '_'.repeat(suffixLength)
}

function protectMarkdownCode(
  content: string,
  /** Indented code blocks too, which only a whole document can tell apart
   *  from indented HTML (markdown-code-ranges.ts). */
  indentedCode = false
): {
  protectedText: string
  codeSpans: string[]
  placeholderPrefix: string
} {
  const placeholderPrefix = codePlaceholderPrefix(content)
  const codeSpans: string[] = []
  const store = (match: string): string => {
    const token = `${placeholderPrefix}${codeSpans.length}${CODE_PLACEHOLDER_SUFFIX}`
    codeSpans.push(match)
    return token
  }

  const lines = content.split('\n')
  const protectedLines: string[] = []
  const blocks = markdownCodeRanges(lines, { indentedCode })
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const blockEnd = blocks.get(index)
    if (blockEnd !== undefined) {
      protectedLines.push(store(lines.slice(index, blockEnd).join('\n')))
      index = blockEnd
      continue
    }

    protectedLines.push(line.replace(/`[^`\n]+`/g, store))
    index += 1
  }

  return { protectedText: protectedLines.join('\n'), codeSpans, placeholderPrefix }
}

function restoreMarkdownCode(
  value: string,
  codeSpans: string[],
  placeholderPrefix: string
): string {
  const placeholderPattern = new RegExp(
    `${escapeRegExp(placeholderPrefix)}(\\d+)${escapeRegExp(CODE_PLACEHOLDER_SUFFIX)}`,
    'g'
  )
  return value.replace(placeholderPattern, (_token, index) => codeSpans[Number(index)] ?? _token)
}

/**
 * A document as MobileMarkdown draws it and the reply's Copy reads it
 * (markdown-plain-text.ts): the blank lines before its first line and the
 * whitespace after its last go, and the first line keeps its indent. One
 * helper for both, so the screen and the clipboard cannot read two documents.
 *
 * Both trimmed it whole, which took the first line's indent too: a reply that
 * opened with an indented code block (`    <div>x</div>`) reached the HTML pass
 * as prose, and `<div>x</div>` drew and copied as `x` (review, 2026-09-30).
 * Anything else before the first line's own spaces and tabs still goes, as
 * the trim took it: a byte-order mark before `# Title` would keep the heading
 * from being one.
 */
export function markdownDocumentSource(content: string | undefined): string {
  const text = content ?? ''
  const first = text.search(/\S/)
  if (first === -1) {
    return ''
  }
  const lineStart = text.lastIndexOf('\n', first - 1) + 1
  let start = first
  while (start > lineStart && (text[start - 1] === ' ' || text[start - 1] === '\t')) {
    start -= 1
  }
  return text.slice(start).trimEnd()
}

export function normalizeMobileMarkdownPreviewHtml(content: string): string {
  const { protectedText, codeSpans, placeholderPrefix } = protectMarkdownCode(
    content.replace(/\r\n?/g, '\n'),
    true
  )
  let next = protectEscapedMarkup(protectedText)

  // Why: repository Markdown often uses small HTML islands for centered README
  // headers and badges. Preview mode should read like Markdown, while Source
  // mode remains the exact file bytes.
  next = replaceMobileMarkdownPairedMarkupTags(
    next,
    ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    (name, inner) => {
      const text = stripTags(normalizeInlineHtml(inner))
      return text ? `\n${'#'.repeat(Number(name.slice(1)))} ${text}\n` : '\n'
    }
  )
  next = replaceMobileMarkdownPairedMarkupTags(next, ['p'], (_name, inner) => {
    const text = stripTags(normalizeInlineHtml(inner))
    return text ? `\n${text}\n` : '\n'
  })
  next = replaceMobileMarkdownPairedMarkupTags(next, ['sub'], (_name, inner) =>
    stripTags(normalizeInlineHtml(inner))
  )
  next = normalizeInlineHtml(next)
  next = stripTags(next)

  return restoreMarkdownCode(restoreEscapedMarkup(restoreEscapedHtmlEntities(next)), codeSpans, placeholderPrefix)
}
