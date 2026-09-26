import {
  canHighlightMobileLanguage,
  highlightMobileCode,
  type MobileSyntaxSegment
} from '../session/mobile-file-syntax'
import {
  detectIndentStep,
  displayColumns,
  expandTabsInSegments,
  indentGuideCounts
} from './mobile-code-indent'
import { formatMinifiedJsonForReading } from './mobile-code-json-format'
import { colorBracketPairs } from './mobile-syntax-brackets'
import { splitSyntaxIntoLines } from './mobile-syntax-lines'

/** Monaco's default; the phone has no editorconfig to read. */
export const CODE_VIEW_TAB_WIDTH = 4

/**
 * Up to this size a file is coloured in one pass, so a string or comment that
 * spans many lines is coloured right everywhere. The old reader stopped at
 * 48,000 characters and went plain past 3,000 spans, because it drew the file
 * as one Text; the lines are windowed now, so only the tokenizer's time on
 * the JS thread is left to bound, and the pass runs after the text is shown.
 */
export const CODE_VIEW_WHOLE_FILE_HIGHLIGHT_CHARS = 128_000
/** Past that, a chunk of this many lines at a time, where the reader looks.
 *  A construct that crosses a chunk edge (a long docstring) may be coloured
 *  wrongly at the start of the next chunk; the rest of the file stays right. */
export const CODE_VIEW_HIGHLIGHT_CHUNK_LINES = 400
/** The guard: past this the file is shown plain. */
export const CODE_VIEW_MAX_HIGHLIGHT_CHARS = 4_000_000
/** One chunk this long is a minified line; it stays plain. */
const MAX_CHUNK_HIGHLIGHT_CHARS = 128_000

/** Languages whose blocks end by dedenting (Monaco's `offSide`). */
const OFF_SIDE_LANGUAGES = new Set(['python', 'python-repl', 'yaml', 'coffeescript'])

export type MobileCodeHighlightMode = 'whole' | 'chunked' | 'none'

/** A file laid out for the code viewer: its lines, their indent guides, the
 *  widest line and how it will be coloured. */
export type MobileCodeDocument = {
  lines: string[]
  language: string
  /** Pretty-printed from minified JSON: the line numbers are not the file's. */
  reformatted: boolean
  tabWidth: number
  indentStep: number
  /** Guides per line, at columns 0, indentStep, 2×indentStep… */
  guides: number[]
  /** The widest line in grid columns, tabs expanded. */
  maxColumns: number
  highlight: MobileCodeHighlightMode
}

export function buildMobileCodeDocument(content: string, language: string): MobileCodeDocument {
  const formatted = language === 'json' ? formatMinifiedJsonForReading(content) : null
  const text = (formatted ?? content).replaceAll('\r\n', '\n')
  const lines = text.split('\n')
  const tabWidth = CODE_VIEW_TAB_WIDTH
  const indentStep = detectIndentStep(lines, tabWidth)
  let maxColumns = 0
  for (const line of lines) {
    maxColumns = Math.max(maxColumns, displayColumns(line, tabWidth))
  }
  return {
    lines,
    language,
    reformatted: formatted !== null,
    tabWidth,
    indentStep,
    guides: indentGuideCounts(lines, {
      tabWidth,
      indentStep,
      offSide: OFF_SIDE_LANGUAGES.has(language)
    }),
    maxColumns,
    highlight: highlightModeFor(text, language)
  }
}

function highlightModeFor(text: string, language: string): MobileCodeHighlightMode {
  if (text.trim().length === 0 || text.length > CODE_VIEW_MAX_HIGHLIGHT_CHARS) {
    return 'none'
  }
  if (!canHighlightMobileLanguage(language)) {
    return 'none'
  }
  return text.length > CODE_VIEW_WHOLE_FILE_HIGHLIGHT_CHARS ? 'chunked' : 'whole'
}

export function codeDocumentChunkCount(doc: MobileCodeDocument): number {
  if (doc.highlight === 'none') {
    return 0
  }
  return doc.highlight === 'whole' ? 1 : Math.ceil(doc.lines.length / CODE_VIEW_HIGHLIGHT_CHUNK_LINES)
}

export function codeDocumentChunkOf(doc: MobileCodeDocument, lineIndex: number): number {
  return doc.highlight === 'chunked' ? Math.floor(lineIndex / CODE_VIEW_HIGHLIGHT_CHUNK_LINES) : 0
}

export function codeDocumentChunkRange(
  doc: MobileCodeDocument,
  chunk: number
): { start: number; end: number } {
  if (doc.highlight !== 'chunked') {
    return { start: 0, end: doc.lines.length }
  }
  const start = chunk * CODE_VIEW_HIGHLIGHT_CHUNK_LINES
  return { start, end: Math.min(doc.lines.length, start + CODE_VIEW_HIGHLIGHT_CHUNK_LINES) }
}

/** One chunk's lines, coloured, brackets by depth, tabs as spaces. Plain when
 *  the chunk is a minified wall of text or the highlighter gives up. */
export function highlightCodeDocumentChunk(
  doc: MobileCodeDocument,
  chunk: number
): MobileSyntaxSegment[][] {
  const { start, end } = codeDocumentChunkRange(doc, chunk)
  const lines = doc.lines.slice(start, end)
  const text = lines.join('\n')
  const plain = () => lines.map((line) => plainLine(line, doc.tabWidth))
  if (doc.highlight === 'none' || text.length > MAX_CHUNK_HIGHLIGHT_CHARS) {
    return plain()
  }
  const result = highlightMobileCode(text, doc.language, Infinity, Infinity)
  if (!result.highlighted) {
    return plain()
  }
  return colorBracketPairs(splitSyntaxIntoLines(result.segments)).map((line) =>
    expandTabsInSegments(line, doc.tabWidth)
  )
}

/** A line before (or without) colour. */
export function plainCodeDocumentLine(doc: MobileCodeDocument, index: number): MobileSyntaxSegment[] {
  return plainLine(doc.lines[index] ?? '', doc.tabWidth)
}

function plainLine(line: string, tabWidth: number): MobileSyntaxSegment[] {
  return line ? expandTabsInSegments([{ text: line, kind: 'plain' }], tabWidth) : []
}
